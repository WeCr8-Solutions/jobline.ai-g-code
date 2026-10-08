// Several computers and model servers: LM Studio, host pools with failover,
// host tags, the git-backed shared queue (two clones racing for the same
// tasks), automatic fix tasks, final checks and golden updates.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createProviders, pingProvider, splitHosts } from '../lib/providers.mjs';
import { createCoordinator, hostCanRun, hostIdentity } from '../lib/coordination.mjs';
import { fileIssueTasks, filesMentioned, issuesFromGate } from '../lib/autotasks.mjs';
import { loadConfig } from '../lib/config.mjs';
import { runPool, runGateLoop, readyTasks } from '../lib/pool.mjs';
import { StateStore } from '../lib/state.mjs';
import { listTasks } from '../lib/tasks.mjs';

const node = JSON.stringify(process.execPath);
const servers = [];
after(() => servers.forEach(s => s.close()));

/** A fake LM Studio / OpenAI-compatible server. */
function fakeServer(reply, hits) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        hits?.push(req.url);
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder-14b-instruct' }] }));
        const { model } = JSON.parse(body || '{}');
        setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: `${reply} (${model})` } }] })), 20);
      });
    });
    server.listen(0, '127.0.0.1', () => { servers.push(server); resolve(`http://127.0.0.1:${server.address().port}`); });
  });
}

const waits = { providerRetry: { baseMs: 1, maxMs: 2, retries: 3 } };

describe('LM Studio and host pools', () => {
  it('talks to LM Studio at /v1 and checks the model is loaded', async () => {
    const url = await fakeServer('diff please');
    const config = { root: '.', providers: { studio: { type: 'lmstudio', host: url, model: 'qwen2.5-coder-14b-instruct' } }, waitsMs: waits };
    const providers = createProviders(config, null);
    assert.equal((await providers.studio.complete({ system: 's', prompt: 'p' })).text, 'diff please (qwen2.5-coder-14b-instruct)');
    assert.match(await pingProvider(config, 'studio'), /^ok/);
    config.providers.studio.model = 'missing-model';
    assert.match(await pingProvider(config, 'studio'), /lms load missing-model/);
  });

  it('reads hosts from a list or a comma-separated environment value', () => {
    assert.deepEqual(splitHosts('http://gpu1:1234, http://gpu2:1234,'), ['http://gpu1:1234', 'http://gpu2:1234']);
    assert.deepEqual(splitHosts(['a', '', 'b']), ['a', 'b']);
    assert.deepEqual(splitHosts(''), []);
  });

  it('spreads requests over hosts and routes around one that is down', async () => {
    const hitsA = [];
    const hitsB = [];
    const a = await fakeServer('from A', hitsA);
    const b = await fakeServer('from B', hitsB);
    const dead = 'http://127.0.0.1:9';
    const events = [];
    const config = {
      providers: { gpus: { type: 'lmstudio', hosts: [dead, a, b], model: 'm', concurrencyPerHost: 1, hostCooldown: '1m' } },
      waitsMs: waits,
    };
    const providers = createProviders(config, { emit: (type, f) => events.push({ type, ...f }) });
    const replies = await Promise.all(Array.from({ length: 6 }, () => providers.gpus.complete({ system: 's', prompt: 'p' })));
    assert.equal(replies.length, 6);
    assert.ok(hitsA.length > 0 && hitsB.length > 0, `both live hosts used (A ${hitsA.length}, B ${hitsB.length})`);
    assert.ok(events.some(e => e.type === 'provider.host-down'), 'dead host was rested');
  });
});

describe('host tags', () => {
  it('includes the platform and configured tags', () => {
    const host = hostIdentity({ host: { name: 'bench-2', tags: 'gpu, vscode' } });
    assert.equal(host.name, 'bench-2');
    assert.ok(host.tags.has('gpu') && host.tags.has('vscode'));
    assert.ok(host.tags.has(process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform));
  });

  it('only offers a host the tasks it can run', () => {
    const host = { tags: new Set(['linux', 'gpu']) };
    assert.equal(hostCanRun({ runsOn: ['gpu'] }, host), true);
    assert.equal(hostCanRun({ runsOn: ['windows'] }, host), false);
    const tasks = [{ id: 'a', enabled: true, dependsOn: [], runsOn: ['windows'] }, { id: 'b', enabled: true, dependsOn: [], runsOn: [] }];
    assert.deepEqual(readyTasks(tasks, { task: () => undefined }, { host }).map(t => t.id), ['b']);
  });
});

function sharedRemote() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-remote-'));
  const remote = path.join(base, 'remote.git');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
  sh(base, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = path.join(base, 'seed');
  sh(base, 'clone', '-q', remote, seed);
  fs.mkdirSync(path.join(seed, 'src'));
  fs.mkdirSync(path.join(seed, 'agent-tasks'));
  fs.writeFileSync(path.join(seed, 'src', 'n.js'), 'module.exports = 0;\n');
  fs.writeFileSync(path.join(seed, '.gitignore'), '.agent-loop/\nnode_modules/\n');
  for (const id of ['t1', 't2', 't3', 't4']) fs.writeFileSync(path.join(seed, 'agent-tasks', `${id}.md`), `---\nid: ${id}\n---\nSet n to ${id}.\n`);
  fs.writeFileSync(path.join(seed, 'agent-loop.config.json'), JSON.stringify({
    concurrency: 2, gate: ['ok'], checks: { ok: `${node} -e "0"` },
    providers: { cli: { type: 'command', mode: 'agentic', run: `${node} -e "require('fs').writeFileSync('src/n.js','module.exports = '+Date.now()+';\\\\n')"` } },
    roles: { develop: { providers: ['cli'] } },
    edits: { allow: ['src/**'] },
    coordination: { mode: 'git', remote: 'origin' },
    waits: { betweenAttempts: { base: '10ms', max: '20ms' }, poll: '50ms', lease: '10m' },
  }));
  sh(seed, 'add', '.');
  sh(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
  sh(seed, 'push', '-q', 'origin', 'main');
  const clone = (name) => { const dir = path.join(base, name); sh(base, 'clone', '-q', remote, dir); return dir; };
  return { remote, clone, sh };
}

describe('shared queue over git', () => {
  it('lets exactly one host claim a task, and takes over an expired lease', async () => {
    const { clone } = sharedRemote();
    const a = createCoordinator(loadConfig(clone('a')));
    const b = createCoordinator(loadConfig(clone('b')));
    const now = Date.now();
    assert.deepEqual(await a.claim('t1', 'hostA:1', 60_000, now), { ok: true });
    const denied = await b.claim('t1', 'hostB:1', 60_000, now);
    assert.equal(denied.ok, false);
    assert.equal(denied.owner, 'hostA:1');
    // An hour later hostA has gone quiet: its lease expired, so hostB may take it.
    assert.deepEqual(await b.claim('t1', 'hostB:1', 60_000, now + 3_600_000), { ok: true });
    assert.equal(await a.renew('t1', 'hostA:1', 60_000), false, 'old owner cannot renew a lease it lost');
    await b.finish('t1', 'hostB:1', 'done', { branch: 'main' });
    const after = await a.claim('t1', 'hostA:1', 60_000, now + 3_600_000);
    assert.deepEqual([after.ok, after.status], [false, 'done']);
  });

  it('two computers working the same queue finish every task exactly once', async () => {
    const { clone, remote, sh } = sharedRemote();
    const one = loadConfig(clone('bench-1'));
    const two = loadConfig(clone('bench-2'));
    one.host.name = 'bench-1';
    two.host.name = 'bench-2';
    const [r1, r2] = await Promise.all([runPool(one, { echo: false }), runPool(two, { echo: false })]);
    const doneBy = { ...Object.fromEntries(Object.entries(r1).map(([k, v]) => [k, `1:${v}`])), ...Object.fromEntries(Object.entries(r2).map(([k, v]) => [k, `2:${v}`])) };
    const all = [...Object.entries(r1), ...Object.entries(r2)];
    assert.deepEqual(all.map(([id]) => id).sort(), ['t1', 't2', 't3', 't4'], `each task run once: ${JSON.stringify(doneBy)}`);
    assert.ok(all.every(([, outcome]) => outcome === 'done'));
    if (process.env.SHOW_SPLIT) console.log('split', JSON.stringify(doneBy));
    const branches = sh(remote, 'branch', '--list', 'agent/*').trim().split('\n').map(s => s.trim()).sort();
    assert.deepEqual(branches, ['agent/t1', 'agent/t2', 'agent/t3', 'agent/t4'], 'finished branches pushed to the shared remote');
    const claims = await createCoordinator(one).list();
    assert.deepEqual(claims.map(c => c.status), ['done', 'done', 'done', 'done']);
  });
});

function scratch(configExtra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-auto-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'post.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.agent-loop/\n');
  fs.writeFileSync(path.join(root, 'agent-loop.config.json'), JSON.stringify({ edits: { allow: ['src/**'] }, ...configExtra }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

describe('automatic fix tasks', () => {
  it('names the files a failure mentions, if agents may edit them', () => {
    const config = loadConfig(scratch());
    const output = 'FAIL src/post.ts:12:3 expected M30\n  at node_modules/x/y.js\n  at src/missing.ts:1';
    assert.deepEqual(filesMentioned(output, config), ['src/post.ts']);
  });

  it('files one task per failing check, refreshes it, and reopens it on regression', async () => {
    const root = scratch();
    const config = loadConfig(root);
    const state = new StateStore(config.stateDir);
    const gate = { failed: [{ name: 'unit', output: 'src/post.ts: expected M30', timedOut: false }], results: [] };
    let filed = await fileIssueTasks(config, issuesFromGate(config, gate), state);
    assert.deepEqual(filed.created, ['auto-gate-unit']);
    const task = listTasks(path.join(root, 'agent-tasks')).tasks[0];
    assert.deepEqual([task.role, task.files, task.auto], ['fix', ['src/post.ts'], true]);

    filed = await fileIssueTasks(config, issuesFromGate(config, gate), state);
    assert.deepEqual([filed.created, filed.refreshed], [[], ['auto-gate-unit']], 'no duplicate');

    await state.patch('auto-gate-unit', { status: 'done' });
    filed = await fileIssueTasks(config, issuesFromGate(config, gate), state);
    assert.deepEqual(filed.reopened, ['auto-gate-unit']);
    assert.equal(state.task('auto-gate-unit'), undefined, 'state cleared so it runs again');

    await state.patch('auto-gate-unit', { status: 'blocked' });
    filed = await fileIssueTasks(config, issuesFromGate(config, gate), state);
    assert.deepEqual(filed.skipped, ['auto-gate-unit'], 'blocked waits for a person');
  });

  it('turns findings a check reports into tasks, within the open-task limit', async () => {
    const reporter = `${node} -e "require('fs').writeFileSync(process.env.AGENT_LOOP_ISSUES_FILE, JSON.stringify([{key:'plunge',title:'Pocket plunges at full depth',files:['src/post.ts'],severity:'warning'},{key:'ramp',title:'No ramp entry'},{key:'third',title:'Third'}]))"`;
    const root = scratch({ gate: ['bench'], checks: { bench: reporter }, autoTasks: { enabled: true, maxOpen: 2 } });
    const config = loadConfig(root);
    const result = await runGateLoop(config, { echo: false });
    assert.equal(result.ok, true, 'findings do not fail the gate');
    const ids = listTasks(path.join(root, 'agent-tasks')).tasks.map(t => t.id).sort();
    assert.deepEqual(ids, ['auto-bench-plunge', 'auto-bench-ramp']);
  });
});

describe('final checks and golden updates', () => {
  it('runs slow checks only after the gate passes, with update env when the task asks', async () => {
    const root = scratch({
      gate: ['fast'],
      checks: {
        fast: `${node} -e "require('fs').appendFileSync('order.log','fast\\\\n')"`,
        golden: { run: `${node} -e "require('fs').appendFileSync('order.log','golden:'+(process.env.UPDATE_GOLDEN||'0')+'\\\\n')"`, updateEnv: { UPDATE_GOLDEN: '1' } },
      },
      providers: { cli: { type: 'command', mode: 'agentic', run: `${node} -e "require('fs').writeFileSync('src/post.ts','export const x = 2;\\\\n')"` } },
      roles: { develop: { providers: ['cli'] } },
      task: { finalChecks: ['golden'] },
      waits: { betweenAttempts: { base: '10ms', max: '20ms' } },
    });
    fs.mkdirSync(path.join(root, 'agent-tasks'));
    fs.writeFileSync(path.join(root, 'agent-tasks', 'g.md'), '---\nid: g\nupdateGoldens: true\n---\nChange x.\n');
    const config = loadConfig(root);
    assert.deepEqual(await runPool(config, { echo: false }), { g: 'done' });
    const log = fs.readFileSync(path.join(config.stateDir, 'worktrees', 'g', 'order.log'), 'utf8');
    assert.equal(log, 'fast\ngolden:1\n');
  });
});
