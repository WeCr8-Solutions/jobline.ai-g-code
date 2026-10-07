// Run state: which tasks are pending, running, done or blocked; who holds a
// lease; and a lock so only one loop of each kind runs per checkout. The old
// CI loop had no lock, which is how a dozen copies came to run the same
// install step within milliseconds of each other.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write via a temp file and rename, so a crash never leaves half a JSON file. */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Take `name`.lock in `dir`. A lock left by a process that no longer exists is
 * taken over. Returns a release function, or throws naming the holder.
 */
export function acquireLock(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.lock`);
  const mine = { pid: process.pid, host: os.hostname(), since: new Date().toISOString() };
  for (let tries = 0; tries < 2; tries++) {
    try {
      fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx' });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const current = readJson(file, null);
        if (current?.pid === process.pid) fs.rmSync(file, { force: true });
      };
      process.once('exit', release);
      return release;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readJson(file, null);
      const sameHost = !holder?.host || holder.host === os.hostname();
      if (holder && sameHost && processAlive(holder.pid)) {
        throw new Error(`Another ${name} loop is running (pid ${holder.pid} since ${holder.since}). Stop it or wait.`);
      }
      if (holder && !sameHost) {
        throw new Error(`${name}.lock is held by ${holder.host} (pid ${holder.pid}). Delete ${file} if that machine is gone.`);
      }
      fs.rmSync(file, { force: true }); // stale: its process is gone
    }
  }
  throw new Error(`Could not take ${file}`);
}

/**
 * Task records keyed by id:
 *   { status: pending|running|done|blocked, attempts, lease: {owner, until},
 *     branch, worktree, lastError, updatedAt, history: [...] }
 * All writes in one process go through a queue, so concurrent workers never
 * lose each other's updates.
 */
export class StateStore {
  constructor(stateDir, clock = Date.now) {
    this.file = path.join(stateDir, 'state.json');
    this.clock = clock;
    this.data = readJson(this.file, { tasks: {}, gate: {} });
    this.data.tasks ??= {};
    this.data.gate ??= {};
    this.queue = Promise.resolve();
  }

  task(id) {
    return this.data.tasks[id];
  }

  update(mutator) {
    const next = this.queue.then(() => {
      this.data = readJson(this.file, this.data); // pick up `reset` from another shell
      this.data.tasks ??= {};
      this.data.gate ??= {};
      const result = mutator(this.data);
      writeJsonAtomic(this.file, this.data);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /** Running tasks whose lease ran out (their worker crashed) go back to pending. */
  recoverExpired() {
    return this.update((data) => {
      const recovered = [];
      for (const [id, record] of Object.entries(data.tasks)) {
        if (record.status === 'running' && (record.lease?.until ?? 0) < this.clock()) {
          record.status = 'pending';
          record.lease = undefined;
          recovered.push(id);
        }
      }
      return recovered;
    });
  }

  /** Claim a task for `owner` if nobody holds a live lease on it. */
  claim(id, owner, leaseMs) {
    return this.update((data) => {
      const record = data.tasks[id] ?? { status: 'pending', attempts: 0, history: [] };
      if (record.status === 'done' || record.status === 'blocked') return false;
      if (record.status === 'running' && (record.lease?.until ?? 0) >= this.clock() && record.lease.owner !== owner) return false;
      record.status = 'running';
      record.lease = { owner, until: this.clock() + leaseMs };
      record.updatedAt = new Date(this.clock()).toISOString();
      data.tasks[id] = record;
      return true;
    });
  }

  renew(id, owner, leaseMs) {
    return this.update((data) => {
      const record = data.tasks[id];
      if (record?.lease?.owner === owner) record.lease.until = this.clock() + leaseMs;
    });
  }

  patch(id, fields) {
    return this.update((data) => {
      const record = (data.tasks[id] ??= { status: 'pending', attempts: 0, history: [] });
      Object.assign(record, fields, { updatedAt: new Date(this.clock()).toISOString() });
      return record;
    });
  }

  addHistory(id, entry) {
    return this.update((data) => {
      const record = (data.tasks[id] ??= { status: 'pending', attempts: 0, history: [] });
      record.history = [...(record.history ?? []), { at: new Date(this.clock()).toISOString(), ...entry }].slice(-50);
    });
  }

  reset(id) {
    return this.update((data) => {
      if (id) delete data.tasks[id];
      else data.tasks = {};
    });
  }

  setGate(fields) {
    return this.update((data) => Object.assign(data.gate, fields));
  }
}
