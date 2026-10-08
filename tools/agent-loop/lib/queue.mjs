// Tasks every computer can see. Task files in a clone's agent-tasks/ folder
// only exist on that clone, so on a shared queue the fix tasks the gate files
// are also published to a branch (default `agent-queue`) holding only
// agent-tasks/*.md. Every computer reads that branch each poll. The main
// branch is never touched; a person merges agent work as usual.

import fs from 'node:fs';
import path from 'node:path';
import { git } from './exec.mjs';
import { parseTask } from './tasks.mjs';

const SEEN = 'refs/agent-queue-seen';

function branchOf(config) {
  return config.coordination.taskBranch || 'agent-queue';
}

async function remoteSha(config) {
  const line = await git(['ls-remote', config.coordination.remote, `refs/heads/${branchOf(config)}`], { cwd: config.root });
  return line.split(/\s+/)[0] || undefined;
}

/** Add or replace task files on the shared branch. `files` are {name, text}. Returns true if anything changed. */
export async function publishTasks(config, files) {
  if (!files.length) return false;
  const cwd = config.root;
  const remote = config.coordination.remote;
  const branch = branchOf(config);
  const index = path.join(config.stateDir, 'queue.index');
  fs.mkdirSync(config.stateDir, { recursive: true });
  const env = { GIT_INDEX_FILE: index };

  for (let tries = 0; tries < 3; tries++) {
    const parent = await remoteSha(config);
    if (parent) {
      await git(['fetch', '-q', '--no-tags', remote, `+refs/heads/${branch}:${SEEN}`], { cwd });
      await git(['read-tree', SEEN], { cwd, env });
    } else {
      await git(['read-tree', '--empty'], { cwd, env });
    }
    for (const file of files) {
      const blob = await git(['hash-object', '-w', '--stdin'], { cwd, input: file.text });
      await git(['update-index', '--add', '--cacheinfo', `100644,${blob},agent-tasks/${file.name}`], { cwd, env });
    }
    const tree = await git(['write-tree'], { cwd, env });
    if (parent && tree === await git(['rev-parse', `${SEEN}^{tree}`], { cwd })) return false;
    const message = `agent-queue: ${files.map(f => f.name.replace(/\.md$/, '')).join(', ')}`;
    const commit = await git(['-c', 'user.name=JobLine Agent Loop', '-c', 'user.email=agent-loop@localhost',
      'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { cwd });
    try {
      await git(['push', '-q', '--no-verify', remote, `${commit}:refs/heads/${branch}`], { cwd });
      return true;
    } catch {
      // Another computer published at the same moment; rebuild on its commit.
    }
  }
  throw new Error(`Could not publish tasks to ${branch} after 3 tries`);
}

let cache = { sha: undefined, tasks: [] };

/** Tasks on the shared branch, parsed. Problems are returned, not thrown. */
export async function readSharedTasks(config) {
  const sha = await remoteSha(config);
  if (!sha) return { tasks: [], problems: [] };
  if (sha === cache.sha) return { tasks: cache.tasks, problems: [] };
  const cwd = config.root;
  await git(['fetch', '-q', '--no-tags', config.coordination.remote, `+refs/heads/${branchOf(config)}:${SEEN}`], { cwd });
  const names = (await git(['ls-tree', '--name-only', SEEN, 'agent-tasks/'], { cwd })).split('\n').filter(n => n.endsWith('.md') && !/readme\.md$/i.test(n));
  const tasks = [];
  const problems = [];
  for (const name of names) {
    try {
      const task = parseTask(await git(['show', `${SEEN}:${name}`], { cwd }), path.join(config.root, name));
      tasks.push({ ...task, shared: true });
    } catch (err) {
      problems.push(`${branchOf(config)}:${name}: ${err.message}`);
    }
  }
  cache = { sha, tasks };
  return { tasks, problems };
}

/** Local tasks win over shared ones with the same id. */
export function mergeTasks(local, shared) {
  const ids = new Set(local.map(t => t.id));
  return [...local, ...shared.filter(t => !ids.has(t.id))]
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
