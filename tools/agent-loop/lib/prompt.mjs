// What each role is told. Prompts are plain and specific: the repo's own
// instructions, the task, the files that matter, and, after a failure, exactly
// which check failed and its output.

import fs from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './util.mjs';

const DIFF_RULES = `Reply with ONE unified diff (git format) inside a single \`\`\`diff block and nothing else.
- Paths are relative to the repository root, with a/ and b/ prefixes. Copy
  the path EXACTLY as shown in that file's "## path" heading below, in full —
  not just the filename. "## src/renderer/styles.css" means the diff path is
  "a/src/renderer/styles.css", never "a/styles.css".
- Include enough unchanged context lines for the diff to apply.
- To create a file, diff from /dev/null. Do not rewrite whole files that only need a small change.
- Only touch files you were shown or files the task asks you to create.

Worked example of the exact format required — a small CSS change to one file:
\`\`\`diff
diff --git a/src/renderer/styles.css b/src/renderer/styles.css
--- a/src/renderer/styles.css
+++ b/src/renderer/styles.css
@@ -12,7 +12,7 @@ body {
 .sidebar {
   width: 240px;
-  min-width: 240px;
+  min-width: 56px;
   flex-shrink: 0;
 }
\`\`\`
Notice: \`@@ -12,7 +12,7 @@\` gives the old and new starting line + line count for
that hunk; every unchanged line starts with a space, every removed line with
\`-\`, every added line with \`+\`; there is no text before \`diff --git\` or after
the closing fence. A diff missing or miscounting the \`@@\` header, or wrapped in
extra prose, will fail to apply — if you are unsure of exact line numbers,
include more surrounding context rather than guessing the count.`;

const AGENTIC_RULES = `Edit the files in the current directory directly. Do not run builds or tests; the harness runs them after you finish.
Only change what the task needs. When you are done, reply with a two-line summary of what you changed.`;

export const ROLE_PROMPTS = {
  develop: 'You are a careful senior engineer implementing a change in this repository.',
  fix: 'You are fixing a change that failed the repository checks. Fix the cause shown in the failure output; do not weaken or delete tests to make them pass.',
  test: 'You are adding focused automated tests. Cover the behaviour the task names, including edge cases a machinist would hit. Do not change production code unless the task says so.',
  review: `You are reviewing a change before a person merges it. Check correctness, safety for machine operators, and that tests cover the change.
Reply with "VERDICT: APPROVE" or "VERDICT: CHANGES" on the first line, then a short list of concrete problems (file, line, what to change). Look at any screenshots for visual regressions.`,
};

function walk(root, dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.agent-loop') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else out.push(path.relative(root, full).replace(/\\/g, '/'));
  }
}

/**
 * Files a prompt carries: the task's own, then context.alwaysInclude (e.g.
 * PLATFORM.md, which says what in this repository is shared with the other
 * JobLine repositories). Task files come first so they win the size budget.
 */
export function contextPatterns(task, config, cwd) {
  // A missing always-include file is skipped, not reported as "to create".
  const always = (config.context?.alwaysInclude ?? []).filter(file => !cwd || fs.existsSync(path.join(cwd, file)));
  return [...new Set([...(task.files ?? []), ...always])];
}

/** The task's files (paths or globs), read from the worktree, within the size budget. */
export function gatherFiles(cwd, patterns, { maxFileBytes, maxContextBytes }) {
  if (!patterns.length) return { files: [], skipped: [] };
  const all = [];
  walk(cwd, cwd, all);
  const wanted = all.filter(file => patterns.some(p => file === p || globToRegExp(p).test(file)));
  const files = [];
  const skipped = [];
  let total = 0;
  for (const file of wanted) {
    const size = fs.statSync(path.join(cwd, file)).size;
    if (size > maxFileBytes || total + size > maxContextBytes) { skipped.push(file); continue; }
    total += size;
    files.push({ path: file, text: fs.readFileSync(path.join(cwd, file), 'utf8') });
  }
  const missing = patterns.filter(p => !/[*?]/.test(p) && !all.includes(p));
  return { files, skipped, missing };
}

export function buildPrompt({ config, task, role, mode, files, failure, diff, attempt }) {
  const system = [
    config.roles[role]?.system ?? ROLE_PROMPTS[role] ?? ROLE_PROMPTS.develop,
    config.context.instructions ? `\nRepository conventions:\n${config.context.instructions}` : '',
    role === 'review' ? '' : `\n${mode === 'agentic' ? AGENTIC_RULES : DIFF_RULES}`,
  ].join('\n').trim();

  const parts = [`# Task: ${task.title}`, task.body];
  if (files.files.length) {
    parts.push('# Current files', ...files.files.map(f => `## ${f.path}\n\`\`\`\n${f.text}\n\`\`\``));
  }
  if (files.missing?.length) parts.push(`These listed files do not exist yet: ${files.missing.join(', ')}`);
  if (files.skipped?.length) parts.push(`Too large to include (ask for less or split the task): ${files.skipped.join(', ')}`);
  if (diff) parts.push('# Change so far (staged in the worktree)', `\`\`\`diff\n${diff}\n\`\`\``);
  if (failure) parts.push(`# Attempt ${attempt - 1} failed`, failure, 'Fix the cause. Your diff applies on top of the change so far.');
  // Closing reminder, deliberately the LAST thing before generation: a long
  // file dump otherwise ends up the most recent context, and small models
  // reliably default to "describe this code" instead of acting on the task
  // stated earlier (confirmed empirically — every local model tested, across
  // three different architectures, did exactly this without this reminder).
  if (role !== 'review') {
    parts.push(`Now do the task: ${task.title}. ${mode === 'agentic' ? 'Edit the files directly.' : 'Reply with ONLY the unified diff — no explanation, no description of the current code, nothing before `diff --git` or after the closing fence.'}`);
  }
  return { system, prompt: parts.join('\n\n') };
}

/** Parse a reviewer reply. Anything without an explicit APPROVE counts as changes requested. */
export function parseVerdict(text) {
  const approve = /VERDICT:\s*APPROVE/i.test(text) && !/VERDICT:\s*CHANGES/i.test(text);
  return { approve, notes: text.trim() };
}
