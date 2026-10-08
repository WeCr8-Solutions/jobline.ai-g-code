// End to end in a scratch git repo, with scripted "models" instead of real
// ones: worktrees, applying diffs, the gate, retry with the failure fed back,
// escalation, review, commit, reports, and an agentic CLI provider.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../lib/config.mjs';
import { runPool, runGateLoop } from '../lib/pool.mjs';
import { StateStore } from '../lib/state.mjs';

const node = JSON.stringify(process.execPath);

function scratchRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-e2e-'));
  const sh = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'agent-tasks'));
  fs.writeFileSync(path.join(root, 'src', 'math.js'), 'exports.add = (a, b) => a - b;\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.agent-loop/\nnode_modules/\n');
  fs.writeFileSync(path.join(root, 'agent-loop.config.json'), JSON.stringify({
    concurrency: 2,
    gate: ['unit'],
    checks: { unit: { run: `${node} -e "process.exit(require('./src/math.js').add(2,3)===5?0:(console.log('add(2,3) should be 5'),1))"`, timeout: '30s' } },
    providers: { local: { type: 'scripted' }, strong: { type: 'scripted' }, reviewer: { type: 'scripted' } },
    roles: { develop: { providers: ['local', 'strong'], escalateAfter: 1 }, fix: { providers: ['local', 'strong'], escalateAfter: 1 }, review: { providers: ['reviewer'] } },
    edits: { allow: ['src/**'] },
    waits: { betweenAttempts: { base: '10ms', max: '20ms' }, providerRetry: { base: '10ms', max: '20ms', retries: 1 }, poll: '50ms' },
    task: { maxAttempts: 3 },
  }, null, 2));
  sh('init', '-q', '-b', 'main');
  sh('add', '.');
  sh('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return root;
}

const wrongFix = '```diff\n--- a/src/math.js\n+++ b/src/math.js\n@@ -1 +1 @@\n-exports.add = (a, b) => a - b;\n+exports.add = (a, b) => a * b;\n```';
const rightFix = '```diff\n--- a/src/math.js\n+++ b/src/math.js\n@@ -1 +1 @@\n-exports.add = (a, b) => a * b;\n+exports.add = (a, b) => a + b;\n```';

describe('agent loop end to end', () => {
  it('retries with the failure, escalates, passes review and commits on the agent branch', async () => {
    const root = scratchRepo();
    fs.writeFileSync(path.join(root, 'agent-tasks', 'fix-add.md'), '---\nid: fix-add\ntitle: Fix add\nfiles: [src/math.js]\nreview: true\n---\nadd() subtracts. Make it add.\n');
    const prompts = [];
    const factories = {
      scripted: (spec) => ({
        mode: 'diff',
        async complete({ prompt, system }) {
          prompts.push({ system, prompt });
          if (/reviewing/.test(system)) return { text: 'VERDICT: APPROVE' };
          // First attempt (local) gets it wrong; the escalated attempt sees the failure and fixes it.
          return { text: /add\(2,3\) should be 5/.test(prompt) ? rightFix : wrongFix };
        },
      }),
    };
    const config = loadConfig(root);
    const results = await runPool(config, { echo: false, providerFactories: factories });
    assert.deepEqual(results, { 'fix-add': 'done' });

    const record = new StateStore(config.stateDir).task('fix-add');
    assert.equal(record.status, 'done');
    assert.equal(record.attempts, 2);
    assert.deepEqual(record.history.map(h => [h.provider, h.outcome]), [['local', 'checks-failed'], ['strong', 'passed']]);
    assert.match(prompts[1].prompt, /add\(2,3\) should be 5/, 'second attempt was told why the first failed');

    const log = execFileSync('git', ['log', '--format=%s', 'agent/fix-add'], { cwd: root }).toString();
    assert.match(log, /agent\(fix-add\): Fix add/);
    assert.equal(fs.readFileSync(path.join(root, 'src', 'math.js'), 'utf8'), 'exports.add = (a, b) => a - b;\n', 'main checkout untouched');
    assert.ok(fs.existsSync(path.join(config.stateDir, 'reports', 'fix-add.md')));
  });

  it('refuses a diff outside the allowed paths and blocks after the last attempt', async () => {
    const root = scratchRepo();
    fs.writeFileSync(path.join(root, 'agent-tasks', 'sneaky.md'), '---\nid: sneaky\nmaxAttempts: 2\n---\nChange the config.\n');
    const factories = {
      scripted: () => ({
        mode: 'diff',
        complete: async () => ({ text: '```diff\n--- a/agent-loop.config.json\n+++ b/agent-loop.config.json\n@@ -1 +1 @@\n-{\n+{"x":1,\n```' }),
      }),
    };
    const config = loadConfig(root);
    const results = await runPool(config, { echo: false, providerFactories: factories });
    assert.deepEqual(results, { sneaky: 'blocked' });
    const record = new StateStore(config.stateDir).task('sneaky');
    assert.deepEqual(record.history.map(h => h.outcome), ['refused-paths', 'refused-paths']);
  });

  it('runs an agentic CLI provider and reverts edits outside the allowed paths', async () => {
    const root = scratchRepo();
    const script = path.join(root, 'fake-agent.js');
    fs.writeFileSync(script, "const fs=require('fs');fs.writeFileSync('src/math.js','exports.add = (a, b) => a + b;\\n');fs.writeFileSync('package.json','{}');console.log('edited');\n");
    const configPath = path.join(root, 'agent-loop.config.json');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    raw.providers = { cli: { type: 'command', mode: 'agentic', run: `${node} ${JSON.stringify(script)}` } };
    raw.roles = { develop: { providers: ['cli'] } };
    fs.writeFileSync(configPath, JSON.stringify(raw));
    fs.writeFileSync(path.join(root, 'agent-tasks', 'cli.md'), '---\nid: cli\n---\nFix add.\n');
    const config = loadConfig(root);
    const results = await runPool(config, { echo: false });
    assert.deepEqual(results, { cli: 'done' });
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'agent/cli'], { cwd: root }).toString().trim().split('\n');
    assert.deepEqual(files, ['src/math.js'], 'package.json edit was reverted before commit');
  });

  it('runs the CI gate once and records the result', async () => {
    const root = scratchRepo();
    const config = loadConfig(root);
    const result = await runGateLoop(config, { echo: false });
    assert.equal(result.ok, false);
    const gate = new StateStore(config.stateDir).data.gate;
    assert.equal(gate.runs, 1);
    assert.deepEqual(gate.lastFailed, ['unit']);
  });
});
