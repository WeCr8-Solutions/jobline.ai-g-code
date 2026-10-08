#!/usr/bin/env node
// JobLine agent loop. See tools/agent-loop/README.md.
//
//   node tools/agent-loop/cli.mjs run [--watch] [--only a,b] [--concurrency N] [--until 06:30] [--for 10h] [--restart-every 2h]
//   node tools/agent-loop/cli.mjs gate [--watch] [--checks a,b] [--file-tasks]
//   node tools/agent-loop/cli.mjs status [--watch]
//   node tools/agent-loop/cli.mjs new "Title" [--role test]
//   node tools/agent-loop/cli.mjs providers
//   node tools/agent-loop/cli.mjs doctor              preflight for an unattended run
//   node tools/agent-loop/cli.mjs monitor [--json] [--watch]   every computer on the shared queue
//   node tools/agent-loop/cli.mjs stats [--by-role] [--since 24h] [--all-hosts]   which models work
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
import { createCoordinator, hostIdentity } from './lib/coordination.mjs';
import { assessHost, freeDiskGb, heartbeatPayload, publishHeartbeat, readHeartbeats } from './lib/monitor.mjs';
import { formatTable, mergeSummaries, readAttempts, summarize } from './lib/stats.mjs';
import { RESTART_EXIT_CODE } from './lib/pool.mjs';
import { git } from './lib/exec.mjs';
import { parseDuration } from './lib/util.mjs';
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

async function printStatus(config) {
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
  const host = hostIdentity(config);
  console.log(`\nThis host: ${host.name} [${[...host.tags].join(', ')}], ${config.coordination.mode} queue`);
  if (config.coordination.mode === 'git') {
    try {
      const claims = await createCoordinator(config).list();
      if (claims.length) {
        console.log(`Shared queue on ${config.coordination.remote}:`);
        for (const c of claims) console.log(`  ${c.id.padEnd(widths[0])}  ${String(c.status ?? '?').padEnd(8)} ${c.owner ?? ''}${c.status === 'running' && c.until ? ` until ${new Date(c.until).toISOString().slice(11, 16)}` : ''}`);
      }
    } catch (err) {
      console.log(`Shared queue unavailable: ${err.message.split('\n')[0]}`);
    }
  }
  const recent = readRecentEvents(config.stateDir, 8);
  if (recent.length) {
    console.log('\nRecent:');
    for (const e of recent) console.log(`  ${e.at?.slice(11, 19)} ${e.task ? `[${e.task}] ` : ''}${e.type}${e.message ? ` - ${e.message}` : ''}`);
  }
}

function printMonitor(report) {
  if (!report.length) {
    console.log('No computer has published a heartbeat yet. Start the loop with JOBLINE_AGENT_QUEUE=git (or monitoring.publish=true).');
    return;
  }
  const age = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3_600_000)}h`);
  for (const r of report.sort((a, b) => a.host.localeCompare(b.host))) {
    const mark = { ok: 'OK  ', attention: 'LOOK', down: 'DOWN', unreadable: '??  ' }[r.health.status];
    const c = r.counts ?? {};
    console.log(`${mark} ${r.host.padEnd(20)} ${String(r.loop ?? '').padEnd(8)} seen ${age(r.health.ageMs ?? 0).padStart(4)} ago  ` +
      `run ${(r.running ?? []).length} · done ${c.done ?? 0} · blocked ${c.blocked ?? 0} · pending ${c.pending ?? 0}  ` +
      `disk ${r.diskFreeGb ?? '?'} GB  ${r.platform ?? ''}`);
    if ((r.running ?? []).length) console.log(`     working on: ${r.running.join(', ')}`);
    for (const p of r.health.problems) console.log(`     ! ${p}`);
  }
  const models = mergeSummaries(report.map(r => r.models ?? []));
  if (models.length) console.log(`\nModels across all computers:\n${formatTable(models)}`);
}

async function doctor(config) {
  let failed = 0;
  const line = (ok, label, detail = '') => {
    if (ok === false) failed++;
    console.log(`${ok === true ? '✓' : ok === false ? '✗' : '!'} ${label}${detail ? ` - ${detail}` : ''}`);
  };
  const host = hostIdentity(config);
  line(true, `host ${host.name}`, `tags ${[...host.tags].join(', ')}; queue ${config.coordination.mode}`);
  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 20, `node ${process.version}`, major >= 20 ? '' : 'Node 20 or later is required');
  try {
    line(true, 'git', await git(['--version'], { cwd: config.root }));
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: config.root });
    const dirty = (await git(['status', '--porcelain', '--untracked-files=no'], { cwd: config.root })).trim();
    line(dirty ? undefined : true, `checkout on ${branch}`, dirty ? 'uncommitted changes: agent worktrees start from the last commit, not these' : 'clean');
  } catch (err) {
    line(false, 'git', err.message.split('\n')[0]);
  }
  line(fs.existsSync(path.join(config.root, 'node_modules')), 'node_modules installed', fs.existsSync(path.join(config.root, 'node_modules')) ? '' : 'run npm ci');
  const disk = freeDiskGb(config.root);
  line(disk === null ? undefined : disk >= config.limits.minFreeDiskGb, 'free disk', disk === null ? 'unknown' : `${disk} GB (minimum ${config.limits.minFreeDiskGb})`);
  if (config.coordination.mode === 'git' || String(config.monitoring?.publish) === 'true') {
    try {
      await git(['ls-remote', '--heads', config.coordination.remote], { cwd: config.root });
      line(true, `remote ${config.coordination.remote} reachable`);
      const state = new StateStore(config.stateDir);
      await publishHeartbeat(config, heartbeatPayload({ config, host, loop: 'doctor', state, startedAt: new Date().toISOString(), note: 'preflight' }));
      line(true, 'can publish heartbeats', `${(config.monitoring?.refPrefix ?? 'refs/heads/agent-hosts/').replace('refs/heads/', '')}${host.name}`);
    } catch (err) {
      line(false, 'shared queue', err.message.split('\n')[0]);
    }
  } else {
    line(undefined, 'shared queue off', 'set JOBLINE_AGENT_QUEUE=git so computers share tasks and can be monitored');
  }
  const used = new Set(Object.values(config.roles).flatMap(r => [].concat(r.providers ?? r.provider)));
  const answering = [];
  for (const name of Object.keys(config.providers)) {
    let result;
    try { result = await pingProvider(config, name); } catch (err) { result = `unreachable (${err.message})`; }
    const ok = /^ok|SDK present|: ok/.test(result);
    if (ok && used.has(name)) answering.push(name);
    line(ok ? true : undefined, `provider ${name}${used.has(name) ? '' : ' (not in any role)'}`, result.replace(/\s+/g, ' '));
  }
  line(answering.length > 0, 'models available to the roles', answering.length ? answering.join(', ') : 'none of the role providers answer: start LM Studio or Ollama, or set up Claude');
  const { tasks, problems } = listTasks(path.join(config.root, config.tasksDir));
  line(problems.length ? false : true, `${tasks.length} task file(s)`, problems.join('; '));
  console.log(failed ? `\n${failed} problem(s) to fix before an unattended run.` : '\nReady for an unattended run.');
  return failed ? 1 : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? 'help';
  const root = path.resolve(args.root ?? process.cwd());
  if (command === 'help' || args.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const config = loadConfig(root, { file: args.config });

  switch (command) {
    case 'run': {
      const results = await runPool(config, {
        watch: Boolean(args.watch), only: list(args.only),
        concurrency: args.concurrency ? Number(args.concurrency) : undefined,
        until: typeof args.until === 'string' ? args.until : undefined,
        forMs: typeof args.for === 'string' ? parseDuration(args.for) : undefined,
        restartEveryMs: typeof args['restart-every'] === 'string' ? parseDuration(args['restart-every']) : undefined,
      });
      if (results.__restart) return RESTART_EXIT_CODE;
      if (results.__deadline) return 0; // stopped at its time; blocked tasks are in the reports
      return Object.entries(results).some(([id, r]) => !id.startsWith('__') && (r === 'blocked' || r === 'crashed')) ? 1 : 0;
    }
    case 'gate': {
      const result = await runGateLoop(config, { watch: Boolean(args.watch), names: list(args.checks), fileTasks: args['file-tasks'] ? true : undefined });
      return result?.ok ? 0 : 1;
    }
    case 'status': {
      do {
        if (args.watch) console.clear();
        await printStatus(config);
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
    case 'doctor':
      return doctor(config);
    case 'monitor': {
      do {
        const beats = await readHeartbeats(config);
        const now = Date.now();
        const report = beats.map(beat => ({ ...beat, health: assessHost(beat, now, { minFreeDiskGb: config.limits.minFreeDiskGb }) }));
        if (args.json) {
          console.log(JSON.stringify({ at: new Date(now).toISOString(), hosts: report, models: mergeSummaries(report.map(r => r.models ?? [])) }, null, 2));
        } else {
          if (args.watch) console.clear();
          printMonitor(report);
        }
        if (!args.watch) return report.some(r => r.health.status !== 'ok') || !report.length ? 1 : 0;
        await sleep(60_000);
      } while (args.watch);
      return 0;
    }
    case 'stats': {
      const sinceMs = typeof args.since === 'string' ? Date.now() - parseDuration(args.since) : undefined;
      if (args['all-hosts']) {
        const beats = await readHeartbeats(config);
        console.log(formatTable(mergeSummaries(beats.map(b => b.models ?? []))));
      } else {
        const rows = summarize(readAttempts(config.stateDir, { sinceMs }), { byRole: Boolean(args['by-role']) });
        console.log(rows.length ? formatTable(rows) : 'No attempts recorded yet (.agent-loop/stats.jsonl).');
      }
      return 0;
    }
    case 'reset': {
      const id = args._[1];
      await new StateStore(config.stateDir).reset(id);
      if (id && config.coordination.mode === 'git') await createCoordinator(config).forget(id);
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
