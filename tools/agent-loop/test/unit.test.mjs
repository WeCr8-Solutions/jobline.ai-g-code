// Unit tests for the pieces that decide waits, pacing, parsing and safety.
// Run: node --test tools/agent-loop/test/

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backoffDelay, createRateLimiter, createSemaphore, expandEnv, globToRegExp, parseDuration, tail } from '../lib/util.mjs';
import { parseFrontMatter, parseTask, listTasks } from '../lib/tasks.mjs';
import { extractPatch, patchPaths, disallowedPaths } from '../lib/patch.mjs';
import { acquireLock, StateStore } from '../lib/state.mjs';
import { providerForAttempt } from '../lib/worker.mjs';
import { readyTasks } from '../lib/pool.mjs';
import { contextPatterns, gatherFiles, parseVerdict } from '../lib/prompt.mjs';
import { loadConfig, ALWAYS_DENIED } from '../lib/config.mjs';
import { createProviders, ProviderError } from '../lib/providers.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-unit-'));

describe('waits and pacing', () => {
  it('reads durations people write', () => {
    assert.equal(parseDuration('500ms'), 500);
    assert.equal(parseDuration('30s'), 30_000);
    assert.equal(parseDuration('5m'), 300_000);
    assert.equal(parseDuration('1.5h'), 5_400_000);
    assert.equal(parseDuration(250), 250);
    assert.throws(() => parseDuration('soon'), /duration/);
  });

  it('backs off exponentially, capped, with jitter in the top half', () => {
    const opts = { baseMs: 1000, maxMs: 8000 };
    assert.equal(backoffDelay(1, { ...opts, jitter: false }), 1000);
    assert.equal(backoffDelay(3, { ...opts, jitter: false }), 4000);
    assert.equal(backoffDelay(10, { ...opts, jitter: false }), 8000);
    assert.equal(backoffDelay(3, opts, () => 0), 2000);
    assert.equal(backoffDelay(3, opts, () => 1), 4000);
  });

  it('paces requests per minute and by minimum gap', async () => {
    let now = 0;
    const waits = [];
    const clock = { now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } };
    const limiter = createRateLimiter({ perMinute: 2, minIntervalMs: 1000 }, clock);
    await limiter.take();
    await limiter.take();
    await limiter.take();
    assert.deepEqual(waits, [1000, 59_000], 'second waits the gap, third waits for the minute window');
  });

  it('never runs more than the limit at once', async () => {
    const semaphore = createSemaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => semaphore.run(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
    })));
    assert.equal(peak, 2);
  });

  it('retries a rate-limited provider after Retry-After, then gives up', async () => {
    const waits = [];
    let calls = 0;
    const config = { providers: { p: { type: 'fake' } }, waitsMs: { providerRetry: { baseMs: 10, maxMs: 100, retries: 2 } } };
    const factories = { fake: () => ({ mode: 'diff', complete: async () => { calls++; throw new ProviderError('429', { retryable: true, retryAfterMs: 5000 }); } }) };
    const providers = createProviders(config, null, { factories, clock: { now: Date.now, sleep: async (ms) => { waits.push(ms); } } });
    await assert.rejects(providers.p.complete({ prompt: '' }), /429/);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [5000, 5000]);
  });
});

describe('text helpers', () => {
  it('keeps the end of long output on a line boundary', () => {
    const out = tail(Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n'), 100);
    assert.match(out, /trimmed/);
    assert.match(out, /line 499$/);
    assert.ok(!/\nine /.test(out));
  });

  it('expands ${VAR} and ${VAR:-default}', () => {
    assert.equal(expandEnv('${A}-${B:-x}', { A: '1' }), '1-x');
  });

  it('matches globs the way the config uses them', () => {
    assert.ok(globToRegExp('src/**').test('src/a/b.ts'));
    assert.ok(globToRegExp('**/*.ts').test('a.ts'));
    assert.ok(globToRegExp('test/*.test.ts').test('test/x.test.ts'));
    assert.ok(!globToRegExp('test/*.test.ts').test('test/sub/x.test.ts'));
  });
});

describe('task files', () => {
  it('parses front matter with inline and dash lists', () => {
    const { data, body } = parseFrontMatter('---\nid: a\nfiles: [x.ts, y.ts]\nchecks:\n  - unit\n  - lint\nreview: true\nmaxAttempts: 3\n---\nDo it.\n');
    assert.deepEqual(data, { id: 'a', files: ['x.ts', 'y.ts'], checks: ['unit', 'lint'], review: true, maxAttempts: 3 });
    assert.equal(body, 'Do it.');
  });

  it('defaults the id from the file name and refuses empty tasks', () => {
    assert.equal(parseTask('Just do it', '/x/Fix Thing.md').id, 'fix-thing');
    assert.throws(() => parseTask('---\nid: a\n---\n', 'a.md'), /no instructions/);
  });

  it('reports duplicate ids instead of running both', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'one.md'), '---\nid: same\n---\nA');
    fs.writeFileSync(path.join(dir, 'two.md'), '---\nid: same\n---\nB');
    const { tasks, problems } = listTasks(dir);
    assert.equal(tasks.length, 1);
    assert.match(problems[0], /already used/);
  });

  it('only offers tasks whose dependencies are done', () => {
    const tasks = [
      { id: 'a', enabled: true, dependsOn: [] },
      { id: 'b', enabled: true, dependsOn: ['a'] },
      { id: 'c', enabled: false, dependsOn: [] },
    ];
    const state = { task: (id) => ({ a: { status: 'done' } })[id] };
    assert.deepEqual(readyTasks(tasks, state).map(t => t.id), ['b']);
    assert.deepEqual(readyTasks(tasks, { task: () => undefined }).map(t => t.id), ['a']);
  });
});

describe('model replies and edit safety', () => {
  const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n';

  it('pulls the diff out of a fenced or bare reply', () => {
    assert.equal(extractPatch(`Sure!\n\`\`\`diff\n${diff}\`\`\`\nDone.`), diff);
    assert.equal(extractPatch(`Here:\n${diff}`), diff);
    assert.equal(extractPatch('No diff here'), '');
  });

  it('lists every path a diff touches, including new files', () => {
    const created = '--- /dev/null\n+++ b/test/new.test.ts\n@@ -0,0 +1 @@\n+ok\n';
    assert.deepEqual(patchPaths(diff + created).sort(), ['src/a.ts', 'test/new.test.ts']);
  });

  it('refuses paths outside the allow list, in the deny list, or escaping the repo', () => {
    const rules = { allow: ['src/**', 'test/**'], deny: ALWAYS_DENIED };
    assert.deepEqual(disallowedPaths(['src/a.ts', 'package.json', 'src/../x', '/etc/passwd', '.github/workflows/x.yml', 'src/.env'], rules),
      ['package.json', 'src/../x', '/etc/passwd', '.github/workflows/x.yml', 'src/.env']);
  });

  it('treats anything but an explicit approval as changes requested', () => {
    assert.equal(parseVerdict('VERDICT: APPROVE\nlooks good').approve, true);
    assert.equal(parseVerdict('Looks fine to me').approve, false);
    assert.equal(parseVerdict('VERDICT: CHANGES\n- fix x').approve, false);
  });

  it('escalates to the next provider after the configured failures', () => {
    const role = { providers: ['local', 'claude'], escalateAfter: 2 };
    assert.deepEqual([1, 2, 3, 4, 5].map(n => providerForAttempt(role, n)), ['local', 'local', 'claude', 'claude', 'claude']);
  });
});

describe('state and locks', () => {
  it('lets only one loop hold the lock, and takes over a dead holder', () => {
    const dir = tmp();
    const release = acquireLock(dir, 'run');
    assert.throws(() => acquireLock(dir, 'run'), /Another run loop/);
    release();
    fs.writeFileSync(path.join(dir, 'run.lock'), JSON.stringify({ pid: 999_999_999, host: os.hostname() }));
    acquireLock(dir, 'run')();
  });

  it('honours leases and returns crashed tasks to pending', async () => {
    let now = 1000;
    const store = new StateStore(tmp(), () => now);
    assert.equal(await store.claim('t', 'w1', 500), true);
    assert.equal(await store.claim('t', 'w2', 500), false);
    now = 2000;
    assert.deepEqual(await store.recoverExpired(), ['t']);
    assert.equal(await store.claim('t', 'w2', 500), true);
    await store.patch('t', { status: 'done' });
    assert.equal(await store.claim('t', 'w3', 500), false);
  });
});

describe('prompt context', () => {
  it('adds context.alwaysInclude files that exist, after the task files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ctx-'));
    fs.writeFileSync(path.join(dir, 'PLATFORM.md'), '# Platform');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export {};');
    const config = { context: { alwaysInclude: ['PLATFORM.md', 'MISSING.md'], maxFileBytes: 1000, maxContextBytes: 10_000 } };
    const patterns = contextPatterns({ files: ['a.ts', 'PLATFORM.md'] }, config, dir);
    assert.deepEqual(patterns, ['a.ts', 'PLATFORM.md']);
    const files = gatherFiles(dir, patterns, config.context);
    assert.deepEqual(files.files.map(f => f.path).sort(), ['PLATFORM.md', 'a.ts']);
    // A missing always-include file is never offered to the model as one to create.
    assert.deepEqual(files.missing, []);
    assert.deepEqual(contextPatterns({ files: [] }, { context: {} }, dir), []);
  });
});

describe('config', () => {
  it('lists every problem at once', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'agent-loop.config.json'), JSON.stringify({
      gate: ['unit', 'missing'], checks: { unit: 'npm test' }, roles: { develop: { providers: ['nope'] } },
    }));
    assert.throws(() => loadConfig(dir), (err) => /missing/.test(err.message) && /nope/.test(err.message));
  });

  it('always protects the harness, git and secrets', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'agent-loop.config.json'), JSON.stringify({ edits: { allow: ['**'] } }));
    const config = loadConfig(dir);
    assert.deepEqual(disallowedPaths(['tools/agent-loop/cli.mjs', 'agent-loop.config.json', '.git/config', 'a/.env', 'src/ok.ts'], config.edits),
      ['tools/agent-loop/cli.mjs', 'agent-loop.config.json', '.git/config', 'a/.env']);
  });
});
