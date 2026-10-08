// Run a configured command with a timeout, capturing output. On timeout or
// abort the whole process tree is killed, so a hung test runner or a stuck
// Electron window doesn't outlive its agent.

import { spawn } from 'node:child_process';

const MAX_CAPTURE = 2_000_000;

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  }
}

/**
 * @param {string} command  shell command line (from config, never from a model)
 * @param {{cwd: string, env?: object, timeoutMs?: number, signal?: AbortSignal, input?: string}} options
 * @returns {Promise<{ok: boolean, code: number|null, output: string, timedOut: boolean, durationMs: number}>}
 */
export function runCommand(command, { cwd, env = {}, timeoutMs = 600_000, signal, input } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0', NO_COLOR: '1', ...env },
      detached: process.platform !== 'win32',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > MAX_CAPTURE) output = output.slice(output.length - MAX_CAPTURE);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : undefined;
    const onAbort = () => killTree(child);
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ok: code === 0 && !timedOut, code, output, timedOut, durationMs: Date.now() - started });
    };
    child.on('error', (err) => { output += `\n${err.message}`; finish(null); });
    child.on('close', finish);
  });
}

/** Run git with arguments (no shell), returning trimmed stdout or throwing with stderr. */
export function git(args, { cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    if (input !== undefined) child.stdin.end(input);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trimEnd());
      else reject(Object.assign(new Error(`git ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`), { code, stderr }));
    });
  });
}
