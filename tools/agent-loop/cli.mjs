#!/usr/bin/env node
// JobLine agent loop. See tools/agent-loop/README.md.
//
//   node tools/agent-loop/cli.mjs run [--watch] [--only a,b] [--concurrency N]
//   node tools/agent-loop/cli.mjs gate [--watch] [--checks a,b]
//   node tools/agent-loop/cli.mjs status [--watch]
//   node tools/agent-loop/cli.mjs new "Title" [--role test]
//   node tools/agent-loop/cli.mjs providers
//   node tools/agent-loop/cli.mjs reset [task-id] [--remove-worktree]

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { runPool, runGateLoop } from './lib/pool.mjs';
import { listTasks, newTaskTemplate } from './lib/tasks.mjs';
import { StateStore } from './lib/state.mjs';
import { readRecentEvents } from './lib/events.mjs';
import { pingProvider } from './lib/providers.mjs';
import { removeWorktree } from './lib/worktree.mjs';
import { sleep } from './lib/util.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; } else args[key] = true;
    } else args._.push(arg);
  }
  return args;
}

const list = (value) => (typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : undefined);

function printStatus(config) {
  const state = new StateStore(config.stateDir);
  const { tasks, problems } = listTasks(path.join(config.root, config.tasksDir));
  const rows = tasks.map((task) => {
    const record = state.task(task.id) ?? {};
    const status = task.enabled ? (record.status ?? 'pending') : 'disabled';
    const waiting = task.dependsOn.filter(dep => state.task(dep)?.status !== 'done');
    return [task.id, status + (status === 'pending' && waiting.length ? ` (after ${waiting.join(', ')})` : ''), String(record.attempts ?? 0), record.lastError?.split('\n')[0] ?? record.history?.at(-1)?.outcome ?? ''];
  });
  const widths = [4, 6, 8, 0].map((min, col) => Math.max(min, ...rows.map(r => r[col].length)));
  const line = (r) => r.map((cell, col) => (col < 3 ? cell.padEnd(widths[col]) : cell)).join('  ');
  console.log(line(['TASK', 'STATUS', 'ATTEMPTS', 'LAST']));
  for (const row of rows) console.log(line(row));
  if (!rows.length) console.log(`(no tasks in ${config.tasksDir}/ - create one with: new "Title")`);
  for (const problem of problems) console.log(`! ${problem}`);
  const gate = state.data.gate;
  if (gate.lastRun) {
    console.log(`\nGate: ${gate.lastOk ? 'passing' : `failing (${(gate.lastFailed ?? []).join(', ')})`} - last run ${gate.lastRun}, ${gate.passes ?? 0}/${gate.runs ?? 0} runs passed`);
  }
  const recent = readRecentEvents(config.stateDir, 8);
  if (recent.length) {
    console.log('\nRecent:');
    for (const e of recent) console.log(`  ${e.at?.slice(11, 19)} ${e.task ? `[${e.task}] ` : ''}${e.type}${e.message ? ` - ${e.message}` : ''}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? 'help';
  const root = path.resolve(args.root ?? process.cwd());
  if (command === 'help' || args.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const config = loadConfig(root, { file: args.config });

  switch (command) {
    case 'run': {
      const results = await runPool(config, {
        watch: Boolean(args.watch), only: list(args.only),
        concurrency: args.concurrency ? Number(args.concurrency) : undefined,
      });
      return Object.values(results).some(r => r === 'blocked' || r === 'crashed') ? 1 : 0;
    }
    case 'gate': {
      const result = await runGateLoop(config, { watch: Boolean(args.watch), names: list(args.checks) });
      return result?.ok ? 0 : 1;
    }
    case 'status': {
      do {
        if (args.watch) console.clear();
        printStatus(config);
        if (args.watch) await sleep(5000);
      } while (args.watch);
      return 0;
    }
    case 'new': {
      const title = args._.slice(1).join(' ');
      if (!title) throw new Error('Usage: new "Title of the task" [--role develop|test|fix]');
      const { id, text } = newTaskTemplate(title, { role: args.role ?? 'develop', checks: config.gate });
      const file = path.join(config.root, config.tasksDir, `${id}.md`);
      if (fs.existsSync(file)) throw new Error(`${file} already exists`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`Created ${path.relative(root, file)} - fill in the instructions and files, then: run`);
      return 0;
    }
    case 'providers': {
      for (const name of Object.keys(config.providers)) {
        let result;
        try { result = await pingProvider(config, name); } catch (err) { result = `unreachable (${err.message})`; }
        console.log(`${name.padEnd(16)} ${config.providers[name].type.padEnd(12)} ${result}`);
      }
      return 0;
    }
    case 'reset': {
      const id = args._[1];
      await new StateStore(config.stateDir).reset(id);
      if (id && args['remove-worktree']) await removeWorktree(config, id, { deleteBranch: Boolean(args['delete-branch']) });
      console.log(id ? `Reset ${id}; it will run again.` : 'Reset all task state.');
      return 0;
    }
    default:
      throw new Error(`Unknown command "${command}". Try: run, gate, status, new, providers, reset`);
  }
}

main().then((code) => process.exit(code ?? 0), (err) => {
  console.error(`agent-loop: ${err.message}`);
  process.exit(2);
});
