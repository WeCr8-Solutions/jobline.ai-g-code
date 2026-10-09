// Turning a model's reply into a change. Models never run anything: in "diff"
// mode they return a unified diff, the harness checks every path it touches
// against the allow/deny lists, and only then applies it with git.

import { git } from './exec.mjs';
import { matchesAny } from './util.mjs';

/** The unified diff in a reply: ```diff / ```patch fences, or a bare diff. */
export function extractPatch(text) {
  const reply = String(text ?? '').replace(/\r\n/g, '\n');
  const fenced = [...reply.matchAll(/```(?:diff|patch)[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]);
  let patch = fenced.join('\n');
  if (!patch.trim()) {
    const start = reply.search(/^(diff --git |--- (a\/|\/dev\/null))/m);
    if (start < 0) return '';
    patch = reply.slice(start).replace(/\n```[\s\S]*$/, '');
  }
  return patch.endsWith('\n') ? patch : `${patch}\n`;
}

/**
 * Small local models reliably drop directory prefixes even when told the
 * exact path (confirmed empirically: qwen2.5-coder:7b and llama3.1:8b both
 * wrote "a/styles.css" instead of "a/src/renderer/styles.css" for the same
 * task, unchanged by adding an explicit instruction). Rather than keep
 * tuning the prompt for something these models don't reliably follow,
 * rewrite basename-only paths to the one known task file they unambiguously
 * match, before the patch ever reaches the allow/deny check or git apply.
 */
export function fixupPaths(patch, knownPaths) {
  if (!knownPaths?.length) return patch;
  const byBasename = new Map();
  for (const p of knownPaths) {
    const base = p.split('/').pop();
    if (byBasename.has(base)) byBasename.set(base, null); // ambiguous, don't guess
    else byBasename.set(base, p);
  }
  const fix = (p) => (knownPaths.includes(p) ? p : byBasename.get(p.split('/').pop()) || p);
  return patch
    .replace(/^diff --git a\/(\S+) b\/(\S+)/gm, (_, a, b) => `diff --git a/${fix(a)} b/${fix(b)}`)
    .replace(/^(---\s+a\/)(\S+)/gm, (_, prefix, p) => `${prefix}${fix(p)}`)
    .replace(/^(\+\+\+\s+b\/)(\S+)/gm, (_, prefix, p) => `${prefix}${fix(p)}`)
    .replace(/^(rename (?:from|to) )(\S+)/gm, (_, prefix, p) => `${prefix}${fix(p)}`);
}

/** Repo-relative paths a patch creates, changes, renames or deletes. */
export function patchPaths(patch) {
  const paths = new Set();
  const strip = (raw) => raw.trim().replace(/\t.*$/, '').replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');
  for (const line of patch.split('\n')) {
    let match;
    if ((match = /^diff --git a\/(\S+) b\/(\S+)/.exec(line))) { paths.add(match[1]); paths.add(match[2]); }
    else if ((match = /^(?:---|\+\+\+) (.+)$/.exec(line)) && !line.includes('/dev/null')) paths.add(strip(match[1]));
    else if ((match = /^rename (?:from|to) (.+)$/.exec(line))) paths.add(match[1].trim());
  }
  return [...paths].filter(Boolean);
}

/** Paths outside the allow list, inside the deny list, or escaping the repo. */
export function disallowedPaths(paths, { allow, deny }) {
  return paths.filter((p) => {
    const normalized = p.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) return true;
    return matchesAny(normalized, deny) || !matchesAny(normalized, allow);
  });
}

/**
 * Apply a patch in `cwd`. `--recount` repairs the wrong hunk line counts
 * models often write; `--3way` copes with context that drifted slightly.
 */
export async function applyPatch(cwd, patch) {
  try {
    await git(['apply', '--check', '--recount', '--whitespace=nowarn', '-'], { cwd, input: patch });
    await git(['apply', '--recount', '--whitespace=nowarn', '-'], { cwd, input: patch });
    return { ok: true };
  } catch (first) {
    try {
      await git(['apply', '--3way', '--recount', '--whitespace=nowarn', '-'], { cwd, input: patch });
      return { ok: true, note: 'applied with 3-way merge' };
    } catch {
      return { ok: false, error: first.stderr?.trim() || first.message };
    }
  }
}
