// Unattended runs across computers: the model scoreboard, stop times, provider
// budgets, heartbeats read back through a git remote, and fix tasks shared
// between clones through the agent-queue branch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { formatTable, mergeSummaries, rankProviders, recordAttempt, readAttempts, smoothedScore, summarize } from '../lib/stats.mjs';
import { deadlineFrom, runPool, runGateLoop } from '../lib/pool.mjs';
import { createProviders, ProviderError } from '../lib/providers.mjs';
import { assessHost, readHeartbeats } from '../lib/monitor.mjs';
import { loadConfig } from '../lib/config.mjs';
import { createCoordinator } from '../lib/coordination.mjs';
import { readSharedTasks } from '../lib/queue.mjs';
import { StateStore } from '../lib/state.mjs';

const node = JSON.stringify(process.execPath);

describe('model scoreboard', () => {
  const records = [
    ...Array.from({ length: 10 }, (_, i) => ({ provider: 'lmstudio', model: 'qwen-14b', role: 'fix', task: `t${i}`, outcome: i < 7 ? 'passed' : 'checks-failed', modelMs: 20_000 + i * 1000, host: 'yumsourcandy' })),
    ...Array.from({ length: 10 }, (_, i) => ({ provider: 'local', model: 'qwen-7b', role: 'fix', task: `u${i}`, outcome: i < 2 ? 'passed' : i < 6 ? 'apply-failed' : 'checks-failed', modelMs: 8000, host: 'mac-mini' })),
    { provider: 'claude', model: 'm', role: 'fix', task: 'v', outcome: 'passed', modelMs: 30_000, host: 'wecr8-lap-1' },
  ];

  it('summarises pass and unusable rates per model', () => {
    const rows = summarize(records);
    const lm = rows.find(r => r.provider === 'lmstudio');
    const ol = rows.find(r => r.provider === 'local');
    assert.deepEqual([lm.attempts, lm.passes, lm.tasksDone, Math.round(lm.passRate * 100)], [10, 7, 7, 70]);
    assert.equal(Math.round(ol.unusableRate * 100), 40, 'diffs that did not apply count as unusable');
    assert.equal(lm.medianModelSeconds, 25);
    assert.match(formatTable(rows), /lmstudio\s+qwen-14b/);
  });

  it('does not let one lucky attempt outrank a proven model', () => {
    assert.ok(smoothedScore(1, 1) < smoothedScore(40, 60));
  });

  it('orders an adaptive role by measured success, keeping untested providers in place', () => {
    assert.deepEqual(rankProviders(['local', 'lmstudio', 'claude'], records, 'fix'), ['lmstudio', 'local', 'claude'], 'claude has one sample, so it stays last');
    assert.deepEqual(rankProviders(['local', 'lmstudio'], records, 'test'), ['local', 'lmstudio'], 'no data for this role: config order');
  });

  it('merges scoreboards from several computers', () => {
    const a = summarize(records.filter(r => r.host === 'yumsourcandy'));
    const b = summarize([{ provider: 'lmstudio', model: 'qwen-14b', role: 'fix', task: 'x', outcome: 'passed', host: 'mac-mini' }]);
    const merged = mergeSummaries([a, b]);
    assert.deepEqual([merged[0].attempts, merged[0].passes, merged[0].hosts], [11, 8, ['mac-mini', 'yumsourcandy']]);
  });

  it('reads back what it records, across rotation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stats-'));
    recordAttempt(dir, { provider: 'p', outcome: 'passed' });
    recordAttempt(dir, { provider: 'p', outcome: 'no-change' });
    assert.equal(readAttempts(dir).length, 2);
  });
});

describe('overnight limits', () => {
  it('works out the next stop time', () => {
    const evening = new Date(2026, 9, 8, 22, 0, 0);
    assert.equal(new Date(deadlineFrom({ until: '06:30' }, evening)).getHours(), 6);
    assert.equal(new Date(deadlineFrom({ until: '06:30' }, evening)).getDate(), 9, 'tomorrow morning');
    assert.equal(deadlineFrom({ forMs: 3_600_000, until: '06:30' }, evening), evening.getTime() + 3_600_000, 'earlier wins');
    assert.throws(() => deadlineFrom({ until: '6am' }), /clock time/);
  });

  it('stops calling a provider once its per-run budget is used', async () => {
    let calls = 0;
    const config = { providers: { claude: { type: 'fake', maxRequestsPerRun: 2 } }, waitsMs: { providerRetry: { baseMs: 1, maxMs: 1, retries: 0 } } };
    const providers = createProviders(config, null, { factories: { fake: () => ({ mode: 'diff', complete: async () => { calls++; return { text: 'x' }; } }) } });
    await providers.claude.complete({});
    await providers.claude.complete({});
    await assert.rejects(providers.claude.complete({}), (err) => err instanceof ProviderError && /budget/.test(err.message));
    assert.equal(calls, 2);
  });

  it('calls a computer down when its heartbeats stop, and flags trouble', () => {
    const now = Date.parse('2026-10-08T06:00:00Z');
    const beat = { host: 'mac-mini', loop: 'run', at: '2026-10-08T05:58:00Z', intervalMs: 300_000, counts: { blocked: 0 }, diskFreeGb: 80, providers: {} };
    assert.equal(assessHost(beat, now).status, 'ok');
    assert.equal(assessHost({ ...beat, at: '2026-10-08T05:30:00Z' }, now).status, 'down');
    const trouble = assessHost({ ...beat, diskFreeGb: 2, counts: { blocked: 2 }, providers: { lmstudio: { consecutiveFailures: 4, lastError: 'unreachable' } } }, now);
    assert.equal(trouble.status, 'attention');
    assert.equal(trouble.problems.length, 3);
  });
});

function sharedRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-overnight-'));
  const remote = path.join(base, 'remote.git');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
  sh(base, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = path.join(base, 'seed');
  sh(base, 'clone', '-q', remote, seed);
  fs.mkdirSync(path.join(seed, 'src'));
  fs.writeFileSync(path.join(seed, 'src', 'post.ts'), 'export const ok = false;\n');
  fs.writeFileSync(path.join(seed, '.gitignore'), '.agent-loop/\nnode_modules/\n');
  fs.writeFileSync(path.join(seed, 'agent-loop.config.json'), JSON.stringify({
    // The gate fails until src/post.ts says ok = true, naming the file in its output.
    gate: ['unit'],
    checks: { unit: `${node} -e "const ok=require('fs').readFileSync('src/post.ts','utf8').includes('true');if(!ok){console.log('FAIL src/post.ts: ok should be true');process.exit(1)}"` },
    providers: { cli: { type: 'command', mode: 'agentic', run: `${node} -e "require('fs').writeFileSync('src/post.ts','export const ok = true;\\\\n')"`, model: 'scripted' } },
    roles: { develop: { providers: ['cli'] }, fix: { providers: ['cli'] } },
    edits: { allow: ['src/**'] },
    coordination: { mode: 'git' },
    autoTasks: { enabled: true },
    waits: { betweenAttempts: { base: '10ms', max: '20ms' }, poll: '50ms', heartbeat: '1m' },
  }));
  sh(seed, 'add', '.');
  sh(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
  sh(seed, 'push', '-q', 'origin', 'main');
  const clone = (name) => {
    const dir = path.join(base, name);
    sh(base, 'clone', '-q', remote, dir);
    const config = loadConfig(dir);
    config.host.name = name;
    return config;
  };
  return { clone, remote, sh };
}

describe('three computers overnight (through a shared git remote)', () => {
  it('the gate on one computer files a fix, another computer does it, and both are visible to monitor', async () => {
    const { clone, remote, sh } = sharedRepo();
    const yum = clone('yumsourcandy');
    const lap = clone('wecr8-lap-1');
    const mac = clone('mac-mini');

    // yumsourcandy runs the gate: it fails, files auto-gate-unit, publishes it to agent-queue.
    const gate = await runGateLoop(yum, { echo: false });
    assert.equal(gate.ok, false);
    assert.match(sh(remote, 'ls-tree', '--name-only', '-r', 'agent-queue'), /agent-tasks\/auto-gate-unit\.md/);

    // The laptop has no local task file, but finds it on the shared branch and fixes it.
    assert.deepEqual((await readSharedTasks(lap)).tasks.map(t => t.id), ['auto-gate-unit']);
    assert.deepEqual(await runPool(lap, { echo: false }), { 'auto-gate-unit': 'done' });
    assert.match(sh(remote, 'show', 'agent/auto-gate-unit:src/post.ts'), /ok = true/);

    // The Mac sees it is done and doesn't redo it.
    assert.deepEqual(await runPool(mac, { echo: false }), {});
    assert.equal(new StateStore(mac.stateDir).task('auto-gate-unit')?.status, 'done');

    // Every computer published heartbeats; the laptop's scoreboard has the attempt.
    const beats = await readHeartbeats(yum);
    assert.deepEqual(beats.map(b => b.host).sort(), ['mac-mini', 'wecr8-lap-1', 'yumsourcandy-gate']);
    const laptop = beats.find(b => b.host === 'wecr8-lap-1');
    assert.equal(laptop.loop, 'stopped');
    assert.equal(laptop.counts.done, 1);
    assert.deepEqual(laptop.models.map(m => [m.provider, m.model, m.passes]), [['cli', 'scripted', 1]]);
    assert.equal(fs.existsSync(path.join(lap.stateDir, 'worktrees', 'auto-gate-unit')), false, 'finished worktree removed; branch kept');
  });

  it('a fixed task that regresses is reopened for every computer', async () => {
    const { clone } = sharedRepo();
    const yum = clone('yumsourcandy');
    const lap = clone('wecr8-lap-1');
    await runGateLoop(yum, { echo: false });
    await runPool(lap, { echo: false });
    // The fix was never merged, so the next gate run on main still fails: as far
    // as the gate knows, a done task is failing again.
    await new StateStore(yum.stateDir).patch('auto-gate-unit', { status: 'done' });
    await runGateLoop(yum, { echo: false });
    const claims = await createCoordinator(yum).list();
    assert.equal(claims.find(c => c.id === 'auto-gate-unit'), undefined, 'shared claim cleared');
    assert.deepEqual(await runPool(lap, { echo: false }), { 'auto-gate-unit': 'done' }, 'laptop runs it again');
  });
});
