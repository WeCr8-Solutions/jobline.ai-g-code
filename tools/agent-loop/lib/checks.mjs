// Running the gate: the ordered list of named checks (typecheck, lint, unit,
// build, smoke, screenshots...) from the config. A shared semaphore keeps a
// flood of agents from all running `npm test` at once and starving the box.

import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from './exec.mjs';
import { tail } from './util.mjs';

const IMAGE = /\.(png|jpe?g|webp)$/i;

function listImages(dir, since) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (IMAGE.test(entry.name) && fs.statSync(full).mtimeMs >= since) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** Copy screenshots a check produced into the attempt's artifact folder. */
function collectScreenshots(cwd, dirs, since, artifactDir) {
  const copied = [];
  for (const dir of dirs) {
    for (const file of listImages(path.resolve(cwd, dir), since)) {
      fs.mkdirSync(artifactDir, { recursive: true });
      const target = path.join(artifactDir, `${copied.length + 1}-${path.basename(file)}`);
      fs.copyFileSync(file, target);
      copied.push(target);
    }
  }
  return copied;
}

/**
 * Run `names` in order inside `cwd`. Stops at the first failing required check
 * (optional ones are recorded and skipped past). Returns per-check results and
 * any screenshots produced.
 */
export async function runGate(config, names, { cwd, semaphore, events, signal, artifactDir, task, attempt }) {
  const results = [];
  const screenshots = [];
  for (const name of names) {
    const check = config.checks[name];
    if (!check) throw new Error(`Unknown check "${name}"`);
    if (signal?.aborted) break;
    const started = Date.now();
    events?.emit('check.start', { task, attempt, check: name });
    const result = await semaphore.run(() => runCommand(check.run, {
      cwd, env: check.env, timeoutMs: check.timeoutMs, signal,
    }));
    const shots = artifactDir && (check.screenshots || check.screenshotDirs)
      ? collectScreenshots(cwd, [].concat(check.screenshotDirs ?? config.artifacts.screenshotDirs), started - 1000, artifactDir)
      : [];
    screenshots.push(...shots);
    const entry = {
      name, ok: result.ok, optional: Boolean(check.optional), timedOut: result.timedOut,
      durationMs: result.durationMs, output: tail(result.output, check.outputChars ?? 6000), screenshots: shots,
    };
    results.push(entry);
    events?.emit(result.ok ? 'check.pass' : 'check.fail', {
      task, attempt, check: name, durationMs: result.durationMs,
      message: result.timedOut ? `${name} timed out after ${Math.round(check.timeoutMs / 1000)}s` : undefined,
    });
    if (!result.ok && !check.optional) break;
  }
  const failed = results.filter(r => !r.ok && !r.optional);
  return { ok: failed.length === 0 && results.length > 0, results, failed, screenshots };
}

/** Failure text to hand the next attempt: which check failed and its output tail. */
export function describeFailures(failed) {
  return failed.map(r => `### ${r.name} ${r.timedOut ? 'timed out' : 'failed'}\n\`\`\`\n${r.output.trim()}\n\`\`\``).join('\n\n');
}
