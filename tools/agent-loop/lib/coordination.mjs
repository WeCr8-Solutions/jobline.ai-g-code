// Several computers working one queue.
//
// Each host runs the loop in its own clone. In "git" mode a host claims a task
// by creating refs/agent-claims/<id> on the shared remote (usually origin):
// creating a ref that already exists is rejected, so two hosts can never take
// the same task, and no server beyond the git remote is needed. The claim
// is a tiny commit whose message holds {status, owner, until, branch}. Lease
// renewal and takeover of an expired lease use --force-with-lease, an atomic
// compare-and-swap on the remote. Finished work is pushed as agent/<id>.
//
// "local" mode (the default) is a single computer; claims live only in
// state.json.

import os from 'node:os';
import { git } from './exec.mjs';

export function hostIdentity(config) {
  const name = (config.host?.name || os.hostname()).trim();
  const platform = { win32: 'windows', darwin: 'macos' }[process.platform] ?? process.platform;
  const tags = new Set([platform, ...String(config.host?.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)]);
  return { name, tags };
}

/** Tasks a host may run: every `runsOn` tag must be one of the host's tags. */
export function hostCanRun(task, host) {
  return (task.runsOn ?? []).every(tag => host.tags.has(tag));
}

function localCoordinator() {
  return {
    mode: 'local',
    async claim() { return { ok: true }; },
    async renew() {},
    async finish() {},
    async release() {},
    async list() { return []; },
  };
}

function gitCoordinator(config, events) {
  const remote = config.coordination.remote ?? 'origin';
  const prefix = (config.coordination.refPrefix ?? 'refs/agent-claims/').replace(/\/?$/, '/');
  const pushBranches = config.coordination.pushBranches !== false;
  const cwd = config.root;
  const ref = (id) => `${prefix}${id}`;
  const seen = (id) => `refs/agent-claims-seen/${id}`;
  let emptyTree;

  async function remoteClaim(id) {
    const line = await git(['ls-remote', remote, ref(id)], { cwd });
    const sha = line.split(/\s+/)[0];
    if (!sha) return undefined;
    await git(['fetch', '-q', '--no-tags', remote, `+${ref(id)}:${seen(id)}`], { cwd });
    let info = {};
    try { info = JSON.parse(await git(['log', '-1', '--format=%B', seen(id)], { cwd })); } catch { /* foreign ref */ }
    return { sha, ...info };
  }

  async function write(id, info, expectedSha) {
    emptyTree ??= await git(['mktree'], { cwd, input: '' });
    const commit = await git(['-c', 'user.name=JobLine Agent Loop', '-c', 'user.email=agent-loop@localhost',
      'commit-tree', emptyTree, '-m', JSON.stringify(info)], { cwd });
    const args = ['push', '-q', '--no-verify', remote];
    if (expectedSha) args.push(`--force-with-lease=${ref(id)}:${expectedSha}`);
    args.push(`${commit}:${ref(id)}`);
    try {
      await git(args, { cwd });
      return commit;
    } catch {
      return undefined; // someone else got there first
    }
  }

  return {
    mode: 'git',
    /** {ok} if this owner now holds the task; otherwise {ok:false, status, owner}. */
    async claim(id, owner, leaseMs, now = Date.now()) {
      const current = await remoteClaim(id);
      if (current && (current.status === 'done' || current.status === 'blocked')) return { ok: false, status: current.status, owner: current.owner };
      if (current && current.status === 'running' && current.owner !== owner && (current.until ?? 0) > now) {
        return { ok: false, status: 'running', owner: current.owner };
      }
      const written = await write(id, { status: 'running', owner, until: now + leaseMs }, current?.sha);
      if (!written) return { ok: false, status: 'running', owner: 'another host' };
      events?.emit('coord.claimed', { task: id, message: current ? `took over from ${current.owner} (lease expired)` : `claimed on ${remote}` });
      return { ok: true };
    },
    async renew(id, owner, leaseMs, now = Date.now()) {
      const current = await remoteClaim(id);
      if (current?.owner !== owner) return false;
      return Boolean(await write(id, { ...current, sha: undefined, status: 'running', owner, until: now + leaseMs }, current.sha));
    },
    async finish(id, owner, status, extra = {}) {
      if (status === 'done' && pushBranches && extra.branch) {
        await git(['push', '-q', '--no-verify', remote, `+refs/heads/${extra.branch}:refs/heads/${extra.branch}`], { cwd });
      }
      const current = await remoteClaim(id);
      await write(id, { status, owner, until: 0, ...extra }, current?.sha);
      events?.emit('coord.finished', { task: id, message: `${status}${status === 'done' && pushBranches ? `; pushed ${extra.branch}` : ''}` });
    },
    /** Hand a paused task back so any host can pick it up. */
    async release(id, owner) {
      const current = await remoteClaim(id);
      if (current?.owner === owner) await write(id, { status: 'pending', owner, until: 0 }, current.sha);
    },
    /** Every claim on the remote, read with a single fetch. */
    async list() {
      const out = await git(['ls-remote', remote, `${prefix}*`], { cwd });
      const entries = out.split('\n').filter(Boolean).map(line => { const [sha, name] = line.split(/\s+/); return { sha, id: name.slice(prefix.length) }; });
      if (!entries.length) return [];
      await git(['fetch', '-q', '--no-tags', remote, `+${prefix}*:refs/agent-claims-seen/*`], { cwd });
      return Promise.all(entries.map(async ({ sha, id }) => {
        let info = {};
        try { info = JSON.parse(await git(['log', '-1', '--format=%B', `refs/agent-claims-seen/${id}`], { cwd })); } catch { /* foreign ref */ }
        return { id, sha, ...info };
      }));
    },
    /** Forget a task everywhere (the `reset` command). */
    async forget(id) {
      await git(['push', '-q', '--no-verify', remote, `:${ref(id)}`], { cwd }).catch(() => {});
    },
  };
}

export function createCoordinator(config, events) {
  return config.coordination?.mode === 'git' ? gitCoordinator(config, events) : localCoordinator();
}
