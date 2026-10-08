// Each task gets its own git worktree and branch (agent/<id>), so a flood of
// agents can edit, build and test side by side without touching each other or
// the checkout a person is working in. Nothing is merged automatically.

import fs from 'node:fs';
import path from 'node:path';
import { git } from './exec.mjs';
import { disallowedPaths } from './patch.mjs';

export function worktreePath(config, id) {
  return path.join(config.stateDir, 'worktrees', id);
}

export function branchName(id) {
  return `agent/${id}`;
}

async function branchExists(root, branch) {
  try {
    await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create (or reuse) the worktree for a task. Returns its absolute path.
 * `fresh`: the task is starting over (new, or reopened after it was done), so
 * an existing branch from an earlier run is archived as
 * agent-archive/<id>-<time> and work starts again from the base.
 */
export async function ensureWorktree(config, id, { fresh = false } = {}) {
  const dir = worktreePath(config, id);
  const branch = branchName(id);
  if (fresh && await branchExists(config.root, branch)) {
    if (fs.existsSync(dir)) await git(['worktree', 'remove', '--force', dir], { cwd: config.root });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    await git(['branch', '-m', branch, `agent-archive/${id}-${stamp}`], { cwd: config.root });
  }
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(['worktree', 'prune'], { cwd: config.root });
    const args = await branchExists(config.root, branch)
      ? ['worktree', 'add', dir, branch]
      : ['worktree', 'add', '-b', branch, dir, config.worktree.base];
    await git(args, { cwd: config.root });
  }
  if (config.worktree.linkNodeModules) linkNodeModules(config.root, dir);
  return dir;
}

/** Share the main checkout's node_modules instead of installing per agent. */
function linkNodeModules(root, dir) {
  const source = path.join(root, 'node_modules');
  const target = path.join(dir, 'node_modules');
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Files changed in the worktree since its last commit (staged, unstaged and new). */
export async function changedFiles(dir) {
  const out = await git(['status', '--porcelain', '-uall', '--no-renames'], { cwd: dir });
  return out.split('\n').filter(Boolean).map(line => line.slice(3).replace(/^"(.*)"$/, '$1'))
    .filter(file => file !== 'node_modules');
}

/**
 * For agents that edit files themselves: undo every change outside the
 * allowed paths. Returns the paths that were reverted.
 */
export async function revertDisallowed(dir, rules) {
  const bad = disallowedPaths(await changedFiles(dir), rules);
  for (const file of bad) {
    try {
      await git(['checkout', 'HEAD', '--', file], { cwd: dir });
    } catch {
      fs.rmSync(path.join(dir, file), { force: true, recursive: true }); // a new file
    }
  }
  return bad;
}

export async function diffText(dir, maxChars = 40_000) {
  await git(['add', '-A', '--', '.', ':!node_modules'], { cwd: dir });
  const diff = await git(['diff', '--cached'], { cwd: dir });
  return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n…(diff trimmed)` : diff;
}

export async function commitAll(dir, message) {
  await git(['add', '-A', '--', '.', ':!node_modules'], { cwd: dir });
  const staged = await git(['diff', '--cached', '--name-only'], { cwd: dir });
  if (!staged) return undefined;
  await git(['-c', 'user.name=JobLine Agent Loop', '-c', 'user.email=agent-loop@localhost', 'commit', '-q', '-m', message], { cwd: dir });
  return git(['rev-parse', 'HEAD'], { cwd: dir });
}

export async function removeWorktree(config, id, { deleteBranch = false } = {}) {
  const dir = worktreePath(config, id);
  if (fs.existsSync(dir)) await git(['worktree', 'remove', '--force', dir], { cwd: config.root });
  if (deleteBranch && await branchExists(config.root, branchName(id))) {
    await git(['branch', '-D', branchName(id)], { cwd: config.root });
  }
}
