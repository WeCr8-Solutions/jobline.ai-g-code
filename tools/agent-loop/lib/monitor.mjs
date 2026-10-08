// Watching computers you can't reach. Each computer running the loop pushes
// a heartbeat to refs/agent-hosts/<name> on the shared git remote: what it is
// doing, its task counts, the last gate result, free disk, which providers
// answer, and its model scoreboard. `monitor` reads every heartbeat from any
// clone, including a cloud session, and flags computers that went quiet,
// are failing, or are running out of disk.

import fs from 'node:fs';
import os from 'node:os';
import { git } from './exec.mjs';
import { readAttempts, summarize } from './stats.mjs';

const PREFIX = 'refs/agent-hosts/';

export function freeDiskGb(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Math.round((s.bavail * s.bsize) / 1e8) / 10;
  } catch {
    return null;
  }
}

/** Everything a heartbeat says about this computer right now. */
export function heartbeatPayload({ config, host, loop, state, running = [], startedAt, providerHealth = {}, note }) {
  const counts = { pending: 0, running: 0, done: 0, blocked: 0 };
  for (const record of Object.values(state.data.tasks)) counts[record.status] = (counts[record.status] ?? 0) + 1;
  const blocked = Object.entries(state.data.tasks).filter(([, r]) => r.status === 'blocked').map(([id, r]) => ({ id, reason: (r.lastError ?? r.history?.at(-1)?.outcome ?? '').split('\n')[0].slice(0, 120) }));
  return {
    host: host.name,
    tags: [...host.tags],
    loop,
    pid: process.pid,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    startedAt,
    at: new Date().toISOString(),
    intervalMs: config.waitsMs.heartbeatMs,
    running,
    counts,
    blocked: blocked.slice(0, 10),
    gate: state.data.gate,
    diskFreeGb: freeDiskGb(config.root),
    load: os.loadavg()[0] ? Math.round(os.loadavg()[0] * 10) / 10 : null,
    memFreeGb: Math.round(os.freemem() / 1e8) / 10,
    providers: providerHealth,
    models: summarize(readAttempts(config.stateDir), { byRole: false }).slice(0, 12),
    note,
  };
}

export async function publishHeartbeat(config, payload) {
  const remote = config.coordination.remote ?? 'origin';
  const cwd = config.root;
  const tree = await git(['mktree'], { cwd, input: '' });
  const commit = await git(['-c', 'user.name=JobLine Agent Loop', '-c', 'user.email=agent-loop@localhost', 'commit-tree', tree, '-m', JSON.stringify(payload)], { cwd });
  // One writer per host, so a forced update is safe.
  await git(['push', '-q', '--no-verify', '--force', remote, `${commit}:${PREFIX}${payload.host}`], { cwd });
}

export async function readHeartbeats(config) {
  const remote = config.coordination.remote ?? 'origin';
  const cwd = config.root;
  const out = await git(['ls-remote', remote, `${PREFIX}*`], { cwd });
  const names = out.split('\n').filter(Boolean).map(line => line.split(/\s+/)[1].slice(PREFIX.length));
  if (!names.length) return [];
  await git(['fetch', '-q', '--no-tags', remote, `+${PREFIX}*:refs/agent-hosts-seen/*`], { cwd });
  return Promise.all(names.map(async (name) => {
    try {
      return JSON.parse(await git(['log', '-1', '--format=%B', `refs/agent-hosts-seen/${name}`], { cwd }));
    } catch {
      return { host: name, unreadable: true };
    }
  }));
}

/** Health verdict for one heartbeat: ok, or the problems a person should look at. */
export function assessHost(beat, now = Date.now(), { minFreeDiskGb = 5 } = {}) {
  const problems = [];
  if (beat.unreadable) return { status: 'unreadable', problems: ['heartbeat could not be read'] };
  const age = now - Date.parse(beat.at);
  const interval = beat.intervalMs ?? 300_000;
  if (beat.loop === 'stopped') problems.push(`stopped ${Math.round(age / 60_000)} min ago${beat.note ? ` (${beat.note})` : ''}`);
  else if (age > interval * 3) problems.push(`no heartbeat for ${Math.round(age / 60_000)} min (expected every ${Math.round(interval / 60_000)})`);
  if (beat.gate?.lastRun && beat.gate.lastOk === false) problems.push(`gate failing: ${(beat.gate.lastFailed ?? []).join(', ')}`);
  if ((beat.counts?.blocked ?? 0) > 0) problems.push(`${beat.counts.blocked} task(s) blocked`);
  if (beat.diskFreeGb != null && beat.diskFreeGb < minFreeDiskGb) problems.push(`only ${beat.diskFreeGb} GB disk free`);
  for (const [name, health] of Object.entries(beat.providers ?? {})) {
    if (health.consecutiveFailures >= 3) problems.push(`${name} failing (${health.lastError ?? 'no reply'})`);
  }
  const stale = problems.some(p => p.startsWith('no heartbeat') || p.startsWith('stopped'));
  return { status: stale ? 'down' : problems.length ? 'attention' : 'ok', problems, ageMs: age };
}

/**
 * Track provider replies and failures for the heartbeat, so a dead LM Studio
 * shows up in `monitor` before anyone notices tasks stalling.
 */
export function createProviderHealth() {
  const health = {};
  return {
    snapshot: () => health,
    observe(event) {
      if (!event.provider) return;
      const name = String(event.provider).split('@')[0];
      const h = (health[name] ??= { replies: 0, failures: 0, consecutiveFailures: 0 });
      if (event.type === 'provider.reply') {
        h.replies++;
        h.consecutiveFailures = 0;
        h.lastReplyAt = event.at;
      } else if (event.type === 'provider.wait' || event.type === 'provider.host-down' || event.type === 'provider.error') {
        h.failures++;
        h.consecutiveFailures++;
        h.lastError = String(event.message ?? '').slice(0, 100);
      }
    },
  };
}
