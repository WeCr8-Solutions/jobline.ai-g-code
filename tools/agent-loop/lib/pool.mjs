// The pool: up to `concurrency` workers pull ready tasks (enabled, not done,
// dependencies done) until none are left, or keep polling for new task files
// in watch mode. Ctrl+C stops cleanly; running tasks go back to pending and
// pick up where they left off next run.

import os from 'node:os';
import path from 'node:path';
import { listTasks } from './tasks.mjs';
import { createProviders } from './providers.mjs';
import { runTask } from './worker.mjs';
import { runGate } from './checks.mjs';
import { acquireLock, StateStore } from './state.mjs';
import { createEventLog } from './events.mjs';
import { createSemaphore, formatDuration, sleep } from './util.mjs';

export function readyTasks(tasks, state, { only } = {}) {
  const status = (id) => state.task(id)?.status ?? 'pending';
  return tasks.filter(task =>
    task.enabled
    && (!only || only.includes(task.id))
    && status(task.id) === 'pending'
    && task.dependsOn.every(dep => status(dep) === 'done'));
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

/** Run tasks. Options: watch (keep polling), only (task ids), concurrency override. */
export async function runPool(config, { watch = false, only, concurrency, echo = true, providerFactories } = {}) {
  const events = createEventLog(config.stateDir, { echo });
  const release = acquireLock(config.stateDir, 'run');
  const stop = stopSignal(events);
  const state = new StateStore(config.stateDir);
  const recovered = await state.recoverExpired();
  if (recovered.length) events.emit('loop.recovered', { message: `resuming ${recovered.join(', ')}` });

  const ctx = {
    config, state, events, signal: stop.signal,
    owner: `${os.hostname()}:${process.pid}`,
    providers: createProviders(config, events, { factories: providerFactories }),
    checkSemaphore: createSemaphore(config.checkConcurrency),
  };
  const limit = Math.max(1, concurrency ?? config.concurrency);
  const running = new Map();
  const results = {};
  events.emit('loop.start', { message: `${limit} worker(s), ${watch ? `watching every ${formatDuration(config.waitsMs.pollMs)}` : 'until the queue is empty'}` });

  try {
    for (;;) {
      const { tasks, problems } = listTasks(path.join(config.root, config.tasksDir));
      for (const problem of problems) events.emit('task.invalid', { message: problem });
      const ready = readyTasks(tasks, state, { only }).filter(task => !running.has(task.id));
      while (running.size < limit && ready.length && !stop.signal.aborted) {
        const task = ready.shift();
        const job = runTask(ctx, task)
          .catch((err) => { events.emit('task.crash', { task: task.id, message: err.message }); return 'crashed'; })
          .then((outcome) => { results[task.id] = outcome; running.delete(task.id); });
        running.set(task.id, job);
      }
      if (stop.signal.aborted) break;
      if (running.size === 0 && !watch) break;
      // All slots busy: wait for a worker to finish. Otherwise also wake on the
      // poll interval, to pick up new task files or tasks whose dependencies finished.
      const wakers = [...running.values()];
      if (running.size < limit) wakers.push(sleep(config.waitsMs.pollMs, stop.signal).catch(() => {}));
      await Promise.race(wakers);
    }
    await Promise.allSettled(running.values());
  } finally {
    stop.dispose();
    release();
  }
  events.emit('loop.end', { message: Object.entries(results).map(([id, r]) => `${id}: ${r}`).join(', ') || 'nothing to do' });
  return results;
}

/**
 * The CI loop: run the gate on the main checkout, once or every
 * `gateInterval`. Replaces the old ci-automation-loop, with a lock so runs
 * can't pile up.
 */
export async function runGateLoop(config, { watch = false, names, echo = true } = {}) {
  const events = createEventLog(config.stateDir, { echo });
  const release = acquireLock(config.stateDir, 'gate');
  const stop = stopSignal(events);
  const state = new StateStore(config.stateDir);
  const semaphore = createSemaphore(1);
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
      last = result;
      if (!watch || stop.signal.aborted) break;
      try { await sleep(config.waitsMs.gateIntervalMs, stop.signal); } catch { break; }
    } while (!stop.signal.aborted);
  } finally {
    stop.dispose();
    release();
  }
  return last;
}
