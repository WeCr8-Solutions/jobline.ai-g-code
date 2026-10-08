// Turning problems into work. When the gate fails on the main checkout, or a
// check reports findings, the loop writes agent-tasks/auto-<key>.md so agents
// start on it without anyone filing it by hand.
//
// A check reports findings by writing JSON to the path in AGENT_LOOP_ISSUES_FILE:
//   [{ "key": "pocket-plunge", "title": "...", "detail": "...",
//      "files": ["src/core/toolpath/pocketRegionGenerator.ts"], "severity": "warning",
//      "checks": ["typecheck", "unit"], "updateGoldens": true }]
//
// One file per key: a finding that is already queued is refreshed, not
// duplicated; one that was fixed and comes back is reopened (a regression).

import fs from 'node:fs';
import path from 'node:path';
import { matchesAny } from './util.mjs';

/** Repo files a failure output mentions, limited to what agents may edit. */
export function filesMentioned(output, config, limit = 6) {
  const found = new Set();
  for (const match of String(output).matchAll(/(?:^|[\s("'`])((?:src|test|e2e|tools)\/[\w./-]+\.(?:tsx?|mjs|cjs|js|json))/gm)) {
    const file = match[1].replace(/[.:]+$/, '');
    if (matchesAny(file, config.edits.allow) && !matchesAny(file, config.edits.deny) && fs.existsSync(path.join(config.root, file))) {
      found.add(file);
    }
    if (found.size >= limit) break;
  }
  return [...found];
}

export function issuesFromGate(config, gateResult) {
  const issues = [];
  for (const failed of gateResult.failed) {
    issues.push({
      key: `gate-${failed.name}`,
      title: `Fix the failing ${failed.name} check`,
      detail: `The \`${failed.name}\` check fails on the main branch${failed.timedOut ? ' (it timed out)' : ''}. Find the cause and fix it; do not weaken or skip tests.\n\n\`\`\`\n${failed.output.trim()}\n\`\`\``,
      files: filesMentioned(failed.output, config),
      role: 'fix',
    });
  }
  for (const result of gateResult.results) {
    for (const issue of result.issues ?? []) issues.push({ role: 'fix', ...issue, key: `${result.name}-${issue.key}` });
  }
  return issues;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Write or refresh task files for `issues`. Returns {created, refreshed,
 * reopened, skipped}. `state` is the StateStore, used to reopen fixed tasks.
 */
export async function fileIssueTasks(config, issues, state, events) {
  const settings = config.autoTasks ?? {};
  const dir = path.join(config.root, config.tasksDir);
  fs.mkdirSync(dir, { recursive: true });
  const openAuto = fs.readdirSync(dir).filter(n => n.startsWith('auto-')).filter(n => {
    const id = n.replace(/\.md$/, '');
    const status = state.task(id)?.status ?? 'pending';
    return status === 'pending' || status === 'running';
  }).length;
  const summary = { created: [], refreshed: [], reopened: [], skipped: [] };
  let budget = Math.max(0, (settings.maxOpen ?? 5) - openAuto);

  for (const issue of issues) {
    const id = `auto-${slug(issue.key)}`;
    const file = path.join(dir, `${id}.md`);
    const record = state.task(id);
    const checks = issue.checks ?? settings.checks ?? config.gate;
    const files = [...new Set(issue.files ?? [])];
    const text = [
      '---',
      `id: ${id}`,
      `title: ${String(issue.title ?? issue.key).replace(/\n/g, ' ')}`,
      `role: ${issue.role ?? 'fix'}`,
      `files: [${files.join(', ')}]`,
      `checks: [${checks.join(', ')}]`,
      `priority: ${issue.severity === 'error' ? 20 : 10}`,
      'auto: true',
      ...(settings.review ? ['review: true'] : []),
      // Fixing a module usually changes the approved output; refresh it so a person reviews the diff.
      ...(issue.updateGoldens ? ['updateGoldens: true'] : []),
      '---',
      issue.detail ?? issue.title,
      '',
      `_Filed automatically by the agent loop at ${new Date().toISOString()}._`,
      '',
    ].join('\n');

    if (fs.existsSync(file)) {
      // A blocked task stays blocked until a person resets it, so a problem
      // agents can't fix doesn't burn model time on every gate run.
      if (record?.status === 'running' || record?.status === 'blocked') { summary.skipped.push(id); continue; }
      fs.writeFileSync(file, text);
      if (record?.status === 'done') {
        await state.reset(id);
        summary.reopened.push(id);
        events?.emit('autotask.reopened', { task: id, message: 'fixed before, failing again (regression)' });
      } else summary.refreshed.push(id);
      continue;
    }
    if (budget <= 0) { summary.skipped.push(id); continue; }
    budget--;
    fs.writeFileSync(file, text);
    summary.created.push(id);
    events?.emit('autotask.created', { task: id, message: issue.title });
  }
  return summary;
}
