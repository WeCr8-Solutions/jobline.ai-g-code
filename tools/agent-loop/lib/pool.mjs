// The pool: up to `concurrency` workers pull ready tasks (enabled, not done,
// dependencies done) until none are left, or keep polling for new task files
// in watch mode. Ctrl+C stops cleanly; running tasks go back to pending and
// pick up where they left off next run.
//
// For unattended runs it also publishes heartbeats (see monitor.mjs), reads
// tasks other computers published, stops taking work at a deadline or when
// disk runs low, and can exit on a schedule so a supervisor pulls the latest
// code and restarts it.

import fs from 'node:fs';
import path from 'node:path';
import { listTasks } from './tasks.mjs';
import { createProviders } from './providers.mjs';
import { runTask } from './worker.mjs';
import { runGate } from './checks.mjs';
import { acquireLock, StateStore } from './state.mjs';
import { createEventLog } from './events.mjs';
import { createSemaphore, formatDuration, parseDuration, sleep } from './util.mjs';
import { createCoordinator, hostCanRun, hostIdentity } from './coordination.mjs';
import { fileIssueTasks, issuesFromGate } from './autotasks.mjs';
import { createProviderHealth, freeDiskGb, heartbeatPayload, publishHeartbeat } from './monitor.mjs';
import { mergeTasks, publishTasks, readSharedTasks } from './queue.mjs';
import { readAttempts, rankProviders } from './stats.mjs';

/** Exit code that asks the supervisor to update and restart (see supervisor/). */
export const RESTART_EXIT_CODE = 75;

export function readyTasks(tasks, state, { only, host } = {}) {
  const status = (id) => state.task(id)?.status ?? 'pending';
  return tasks.filter(task =>
    task.enabled
    && (!only || only.includes(task.id))
    && (!host || hostCanRun(task, host))
    && status(task.id) === 'pending'
    && task.dependsOn.every(dep => status(dep) === 'done'));
}

/**
 * When to stop taking new work. `until` is a local clock time ("06:30", the
 * next one to come); `forMs` a duration from now. The earlier one wins.
 */
export function deadlineFrom({ until, forMs } = {}, now = new Date()) {
  const candidates = [];
  if (forMs) candidates.push(now.getTime() + forMs);
  if (until) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(until).trim());
    if (!match) throw new Error(`--until wants a clock time like 06:30, not "${until}"`);
    const at = new Date(now);
    at.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    candidates.push(at.getTime());
  }
  return candidates.length ? Math.min(...candidates) : undefined;
}

function stopSignal(events) {
  const controller = new AbortController();
  let presses = 0;
  const onSignal = () => {
    presses++;
    if (presses === 1) {
      events.emit('loop.stopping', { message: 'finishing current steps; press Ctrl+C again to exit now' });
      controller.abort(new Error('stopped'));
    } else process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return { signal: controller.signal, dispose: () => { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); } };
}

/** Event log whose events also feed provider health for heartbeats. */
function observedEvents(config, echo) {
  const log = createEventLog(config.stateDir, { echo });
  const health = createProviderHealth();
  return {
    file: log.file,
    health,
    emit(type, fields) {
      const event = log.emit(type, fields);
      health.observe(event);
      return event;
    },
  };
}

function publishing(config) {
  return config.coordination.mode === 'git' || String(config.monitoring?.publish) === 'true';
}

/** Heartbeats on a timer. Failures are logged once, then retried quietly. */
function startHeartbeat({ config, host, loop, state, events, running, startedAt }) {
  if (!publishing(config)) return { beat: async () => {}, stop: async () => {} };
  let warned = false;
  let stopped = false;
  let chain = Promise.resolve();
  // One push at a time, and nothing after the final "stopped" beat, so a late
  // beat can't overwrite it.
  const beat = (overrides = {}, final = false) => {
    if (stopped && !final) return chain;
    if (final) stopped = true;
    chain = chain.then(() => send(overrides));
    return chain;
  };
  const send = async (overrides) => {
    try {
      await publishHeartbeat(config, heartbeatPayload({
        config, host, loop, state, startedAt, running: [...(running?.keys() ?? [])],
        providerHealth: events.health.snapshot(), ...overrides,
      }));
      warned = false;
    } catch (err) {
      if (!warned) events.emit('monitor.error', { message: `heartbeat not published: ${err.message.split('\n')[0]}` });
      warned = true;
    }
  };
  const timer = setInterval(() => { void beat(); }, config.waitsMs.heartbeatMs);
  timer.unref?.();
  void beat();
  return { beat, stop: async (note) => { clearInterval(timer); await beat({ loop: 'stopped', note }, true); } };
}

/**
 * Run tasks. Options: watch (keep polling), only (task ids), concurrency
 * override, until/forMs (stop taking work), restartEveryMs (exit with
 * RESTART_EXIT_CODE so the supervisor updates).
 */
export async function runPool(config, { watch = false, only, concurrency, echo = true, providerFactories, until, forMs, restartEveryMs } = {}) {
  const events = observedEvents(config, echo);
  const release = acquireLock(config.stateDir, 'run');
  const stop = stopSignal(events);
  const state = new StateStore(config.stateDir);
  const recovered = await state.recoverExpired();
  if (recovered.length) events.emit('loop.recovered', { message: `resuming ${recovered.join(', ')}` });

  const host = hostIdentity(config);
  const coordinator = createCoordinator(config, events);
  const providers = createProviders(config, events, { factories: providerFactories });
  const roleOrder = new Map();
  const ctx = {
    config, state, events, signal: stop.signal, host,
    owner: `${host.name}:${process.pid}`,
    coordinator,
    providers,
    checkSemaphore: createSemaphore(config.checkConcurrency),
    // Adaptive roles: providers in order of measured success (refreshed each poll).
    providerOrder: (role, spec) => roleOrder.get(role) ?? [].concat(spec.providers ?? spec.provider),
  };
  const limit = Math.max(1, concurrency ?? config.concurrency);
  const running = new Map();
  const results = {};
  const startedAt = new Date().toISOString();
  const deadline = deadlineFrom({ until: until ?? (config.limits.until || undefined), forMs: forMs ?? config.limitsMs.maxRuntimeMs });
  const restartAt = (restartEveryMs ?? config.limitsMs.restartEveryMs) ? Date.now() + (restartEveryMs ?? config.limitsMs.restartEveryMs) : undefined;
  const heartbeat = startHeartbeat({ config, host, loop: 'run', state, events, running, startedAt });
  events.emit('loop.start', { message: `${host.name} [${[...host.tags].join(', ')}], ${limit} worker(s), ${coordinator.mode} queue, ${watch ? `watching every ${formatDuration(config.waitsMs.pollMs)}` : 'until the queue is empty'}${deadline ? `, stops taking work at ${new Date(deadline).toLocaleTimeString()}` : ''}` });
  const skipped = new Set();
  let stopReason = 'queue empty';
  let lastDiskWarning = 0;

  try {
    for (;;) {
      const local = listTasks(path.join(config.root, config.tasksDir));
      let tasks = local.tasks;
      for (const problem of local.problems) events.emit('task.invalid', { message: problem });
      if (coordinator.mode === 'git') {
        try {
          const shared = await readSharedTasks(config);
          tasks = mergeTasks(local.tasks, shared.tasks);
          for (const problem of shared.problems) events.emit('task.invalid', { message: problem });
          await syncFromRemote(coordinator, state);
        } catch (err) {
          events.emit('coord.error', { message: `shared queue unreadable: ${err.message.split('\n')[0]}` });
        }
      }
      for (const [role, spec] of Object.entries(config.roles)) {
        if (spec.adaptive) roleOrder.set(role, rankProviders([].concat(spec.providers), readAttempts(config.stateDir), role, { minSamples: spec.minSamples ?? 6 }));
      }

      const now = Date.now();
      const pastDeadline = deadline !== undefined && now >= deadline;
      const restartDue = restartAt !== undefined && now >= restartAt;
      const disk = freeDiskGb(config.root);
      const diskLow = disk !== null && disk < config.limits.minFreeDiskGb;
      if (diskLow && now - lastDiskWarning > 3_600_000) {
        events.emit('loop.disk-low', { message: `${disk} GB free (< ${config.limits.minFreeDiskGb}); not starting new tasks` });
        lastDiskWarning = now;
      }

      const ready = readyTasks(tasks, state, { only, host }).filter(task => !running.has(task.id) && !skipped.has(task.id));
      while (running.size < limit && ready.length && !stop.signal.aborted && !pastDeadline && !restartDue && !diskLow) {
        const task = ready.shift();
        const job = runTask(ctx, task)
          .catch((err) => { events.emit('task.crash', { task: task.id, message: err.message }); return 'crashed'; })
          .then((outcome) => {
            if (outcome === 'skipped') skipped.add(task.id);
            else results[task.id] = outcome;
            running.delete(task.id);
            void heartbeat.beat();
          });
        running.set(task.id, job);
        void heartbeat.beat();
      }
      if (stop.signal.aborted) { stopReason = 'stopped by signal'; break; }
      if ((pastDeadline || restartDue) && running.size === 0) { stopReason = restartDue ? 'scheduled restart' : 'deadline'; break; }
      if (running.size === 0 && !watch) break;
      if (running.size === 0 && watch) skipped.clear();
      // All slots busy: wait for a worker to finish. Otherwise also wake on the
      // poll interval, to pick up new task files or tasks whose dependencies finished.
      const wakers = [...running.values()];
      if (running.size < limit) wakers.push(sleep(config.waitsMs.pollMs, stop.signal).catch(() => {}));
      await Promise.race(wakers);
    }
    await Promise.allSettled(running.values());
  } finally {
    stop.dispose();
    await heartbeat.stop(stopReason);
    release();
  }
  events.emit('loop.end', { message: `${stopReason}: ${Object.entries(results).map(([id, r]) => `${id}: ${r}`).join(', ') || 'nothing done'}` });
  if (stopReason === 'scheduled restart') results.__restart = true;
  if (stopReason === 'deadline') results.__deadline = true;
  return results;
}

/**
 * On a shared queue the remote claims are the record of what is finished. If
 * a claim for a task this computer has as done or blocked was removed (the
 * gate reopened it as a regression, or someone ran `reset`), forget the local
 * record so the task can run again.
 */
async function syncFromRemote(coordinator, state) {
  const finished = Object.entries(state.data.tasks).filter(([, r]) => r.status === 'done' || r.status === 'blocked');
  if (!finished.length) return;
  const claims = new Set((await coordinator.list()).map(c => c.id));
  for (const [id] of finished) if (!claims.has(id)) await state.reset(id);
}

/**
 * The CI loop: run the gate on the main checkout, once or every
 * `gateInterval`. Replaces the old ci-automation-loop, with a lock so runs
 * can't pile up.
 */
export async function runGateLoop(config, { watch = false, names, echo = true, fileTasks } = {}) {
  const events = observedEvents(config, echo);
  const release = acquireLock(config.stateDir, 'gate');
  const stop = stopSignal(events);
  const state = new StateStore(config.stateDir);
  const semaphore = createSemaphore(1);
  const host = hostIdentity(config);
  const coordinator = createCoordinator(config, events);
  // The gate's heartbeat goes under its own name so it doesn't overwrite the run loop's.
  const heartbeat = startHeartbeat({ config: { ...config, host: { ...config.host, name: `${host.name}-gate` } }, host: { ...host, name: `${host.name}-gate` }, loop: 'gate', state, events, startedAt: new Date().toISOString() });
  let last;
  try {
    do {
      const started = Date.now();
      const result = await runGate(config, names ?? config.gate, { cwd: config.root, semaphore, events, signal: stop.signal });
      const previous = state.data.gate;
      await state.setGate({
        lastRun: new Date(started).toISOString(),
        lastOk: result.ok,
        runs: (previous.runs ?? 0) + 1,
        passes: (previous.passes ?? 0) + (result.ok ? 1 : 0),
        lastFailed: result.failed.map(f => f.name),
      });
      events.emit(result.ok ? 'gate.pass' : 'gate.fail', { message: result.ok ? `all ${result.results.length} checks passed` : `failed: ${result.failed.map(f => f.name).join(', ')}` });
      // Failures and reported findings become agent tasks.
      if (fileTasks ?? config.autoTasks.enabled) {
        const issues = issuesFromGate(config, result);
        if (issues.length) {
          const filed = await fileIssueTasks(config, issues, state, events);
          events.emit('gate.tasks', { message: `created ${filed.created.length}, refreshed ${filed.refreshed.length}, reopened ${filed.reopened.length}, skipped ${filed.skipped.length}` });
          if (coordinator.mode === 'git') await shareFiledTasks(config, coordinator, filed, events);
        }
      }
      await heartbeat.beat();
      last = result;
      if (!watch || stop.signal.aborted) break;
      try { await sleep(config.waitsMs.gateIntervalMs, stop.signal); } catch { break; }
    } while (!stop.signal.aborted);
  } finally {
    stop.dispose();
    await heartbeat.stop(stop.signal.aborted ? 'stopped by signal' : 'single run');
    release();
  }
  return last;
}

/** Put newly filed tasks on the shared branch; clear claims of reopened ones so any computer can retry them. */
async function shareFiledTasks(config, coordinator, filed, events) {
  const ids = [...filed.created, ...filed.refreshed, ...filed.reopened];
  if (!ids.length) return;
  try {
    const files = ids.map(id => ({ name: `${id}.md`, text: fs.readFileSync(path.join(config.root, config.tasksDir, `${id}.md`), 'utf8') }));
    if (await publishTasks(config, files)) events.emit('queue.published', { message: `${ids.length} task(s) on ${config.coordination.taskBranch}` });
    for (const id of filed.reopened) await coordinator.forget(id);
  } catch (err) {
    events.emit('coord.error', { message: `could not share filed tasks: ${err.message.split('\n')[0]}` });
  }
}

export { parseDuration };
