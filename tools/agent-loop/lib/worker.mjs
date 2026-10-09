// One task, start to finish:
//
//   claim lease → worktree on agent/<id> → [ ask model → apply change →
//   run gate (+ screenshots) → optional review ] → commit, or wait and retry
//   with the failure → after maxAttempts, mark blocked with a report.
//
// Attempts escalate: a role can list several providers (say a local model,
// then Claude) and move to the next after `escalateAfter` failures.

import fs from 'node:fs';
import path from 'node:path';
import { applyPatch, disallowedPaths, extractPatch, fixupPaths, patchPaths } from './patch.mjs';
import { describeFailures, runGate } from './checks.mjs';
import { buildPrompt, contextPatterns, gatherFiles, parseVerdict } from './prompt.mjs';
import { changedFiles, commitAll, diffText, ensureWorktree, revertDisallowed, branchName, removeWorktree } from './worktree.mjs';
import { runCommand } from './exec.mjs';
import { ProviderError } from './providers.mjs';
import { recordAttempt } from './stats.mjs';
import { backoffDelay, formatDuration, sleep } from './util.mjs';

/** Which provider handles attempt `n` for a role. `order` overrides the config order (adaptive roles). */
export function providerForAttempt(roleSpec, attempt, order) {
  const list = order ?? [].concat(roleSpec.providers ?? roleSpec.provider);
  const step = Math.max(1, roleSpec.escalateAfter ?? 2);
  return list[Math.min(list.length - 1, Math.floor((attempt - 1) / step))];
}

function writeReport(config, task, record, lines) {
  const dir = path.join(config.stateDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${task.id}.md`);
  const rows = (record.history ?? []).map(h =>
    `| ${h.attempt ?? ''} | ${h.provider ?? ''} | ${h.outcome} | ${(h.detail ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160)} |`);
  fs.writeFileSync(file, [
    `# ${task.title}`, '',
    `- Task: \`${task.id}\` (${path.relative(config.root, task.filePath)})`,
    `- Status: **${record.status}** after ${record.attempts} attempt(s)`,
    `- Branch: \`${branchName(task.id)}\``,
    ...lines, '',
    '| Attempt | Provider | Outcome | Detail |', '| --- | --- | --- | --- |', ...rows, '',
  ].join('\n'));
  return file;
}

export async function runTask(ctx, task) {
  const { config, state, events, providers, checkSemaphore, signal, owner, coordinator } = ctx;
  if (!(await state.claim(task.id, owner, config.waitsMs.leaseMs))) return 'skipped';
  // On a shared queue, another computer may already have it.
  const shared = await coordinator.claim(task.id, owner, config.waitsMs.leaseMs);
  if (!shared.ok) {
    await state.patch(task.id, { status: shared.status === 'running' ? 'pending' : shared.status, lease: undefined, heldBy: shared.owner, fromShared: shared.status !== 'running' });
    return 'skipped';
  }
  const finish = async (status, extra = {}) => coordinator.finish(task.id, owner, status, { branch: branchName(task.id), ...extra }).catch(err =>
    events.emit('coord.error', { task: task.id, message: err.message.split('\n')[0] }));
  const maxAttempts = task.maxAttempts ?? config.task.maxAttempts;
  const gate = task.checks ?? config.gate;
  const review = task.review ?? config.task.review;
  const record = state.task(task.id);
  const startAttempt = (record?.attempts ?? 0) + 1;

  let cwd;
  try {
    cwd = await ensureWorktree(config, task.id, { fresh: startAttempt === 1 });
    for (const setup of config.worktree.setup) {
      const result = await runCommand(setup, { cwd, timeoutMs: 15 * 60_000, signal });
      if (!result.ok) throw new Error(`worktree setup "${setup}" failed:\n${result.output.slice(-2000)}`);
    }
  } catch (err) {
    await state.patch(task.id, { status: 'blocked', lastError: err.message, lease: undefined });
    await finish('blocked');
    events.emit('task.blocked', { task: task.id, message: err.message.split('\n')[0] });
    return 'blocked';
  }
  await state.patch(task.id, { worktree: cwd, branch: branchName(task.id) });
  events.emit('task.start', { task: task.id, message: `${task.title} (attempt ${startAttempt} of ${maxAttempts})` });

  let failure = record?.lastFailure;
  for (let attempt = startAttempt; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) break;
    await state.patch(task.id, { attempts: attempt });
    await state.renew(task.id, owner, config.waitsMs.leaseMs);
    await coordinator.renew(task.id, owner, config.waitsMs.leaseMs).catch(() => {});
    const role = attempt === 1 || !failure ? task.role : (config.roles.fix ? 'fix' : task.role);
    const roleSpec = config.roles[role] ?? config.roles[task.role] ?? config.roles.develop;
    if (!roleSpec) throw new Error(`No role "${role}" (or "develop") in the config`);
    const providerName = providerForAttempt(roleSpec, attempt, ctx.providerOrder?.(role, roleSpec));
    const provider = providers[providerName];
    let modelMs;
    const outcome = (kind, detail) => {
      recordAttempt(config.stateDir, {
        host: ctx.host?.name, task: task.id, role, provider: providerName, model: provider.model, mode: provider.mode,
        attempt, outcome: kind, modelMs, auto: task.auto || undefined,
      });
      return state.addHistory(task.id, { attempt, provider: providerName, outcome: kind, detail });
    };

    try {
      // 1. Ask the model for a change.
      const files = gatherFiles(cwd, contextPatterns(task, config, cwd), config.context);
      const diffSoFar = attempt > 1 ? await diffText(cwd) : '';
      const { system, prompt } = buildPrompt({ config, task, role, mode: provider.mode, files, failure, diff: diffSoFar, attempt });
      events.emit('model.ask', { task: task.id, attempt, provider: providerName, message: `${role} via ${providerName}` });
      const asked = Date.now();
      const reply = await provider.complete({ system, prompt, cwd, signal, task: task.id, attempt });
      modelMs = Date.now() - asked;

      // 2. Apply it (diff mode) or police it (agentic mode).
      if (provider.mode === 'diff') {
        if (reply.truncated) throw Object.assign(new Error('The reply hit the output limit before the diff ended. Make a smaller change.'), { kind: 'no-change' });
        const patch = fixupPaths(extractPatch(reply.text), task.files);
        if (!patch.trim()) throw Object.assign(new Error('The reply contained no diff. Reply with a ```diff block only.'), { kind: 'no-change' });
        const bad = disallowedPaths(patchPaths(patch), config.edits);
        if (bad.length) throw Object.assign(new Error(`The diff touches paths you may not change: ${bad.join(', ')}. Only change ${config.edits.allow.join(', ')}.`), { kind: 'refused-paths' });
        const applied = await applyPatch(cwd, patch);
        if (!applied.ok) throw Object.assign(new Error(`The diff did not apply:\n${applied.error}\nRe-read the current files and produce a diff against them.`), { kind: 'apply-failed' });
      } else {
        const reverted = await revertDisallowed(cwd, config.edits);
        if (reverted.length) events.emit('edits.reverted', { task: task.id, attempt, message: reverted.join(', ') });
      }
      if (!(await changedFiles(cwd)).length) throw Object.assign(new Error('No files changed.'), { kind: 'no-change' });

      // 3. Run the gate, collecting screenshots.
      const artifactDir = path.join(config.stateDir, 'artifacts', task.id, `attempt-${attempt}`);
      const gateOptions = { cwd, semaphore: checkSemaphore, events, signal, artifactDir, task: task.id, attempt, updateGoldens: task.updateGoldens };
      let result = await runGate(config, gate, gateOptions);
      // Slow checks (build, e2e, regression) run once the fast gate passes.
      const finalChecks = (config.task.finalChecks ?? []).filter(name => !gate.includes(name));
      if (result.ok && finalChecks.length) {
        const final = await runGate(config, finalChecks, gateOptions);
        result = { ok: final.ok, results: [...result.results, ...final.results], failed: final.failed, screenshots: [...result.screenshots, ...final.screenshots] };
      }
      if (!result.ok) {
        failure = describeFailures(result.failed);
        await outcome('checks-failed', result.failed.map(f => f.name).join(', '));
        await state.patch(task.id, { lastFailure: failure });
      } else {
        // 4. Optional review by another model, with the screenshots.
        let approved = true;
        if (review && config.roles.review) {
          const reviewer = providers[providerForAttempt(config.roles.review, 1)];
          const { system: rs, prompt: rp } = buildPrompt({ config, task, role: 'review', mode: 'diff', files: { files: [] }, diff: await diffText(cwd), attempt });
          const images = reviewer.vision ? result.screenshots.slice(0, 6) : [];
          const verdict = parseVerdict((await reviewer.complete({ system: rs, prompt: rp, images, cwd, signal, task: task.id, attempt })).text);
          approved = verdict.approve;
          events.emit(approved ? 'review.approve' : 'review.changes', { task: task.id, attempt, provider: reviewer.name });
          if (!approved) {
            failure = `### Review requested changes\n${verdict.notes}`;
            await outcome('review-changes', verdict.notes.split('\n').slice(1, 3).join(' '));
            await state.patch(task.id, { lastFailure: failure });
          }
        }
        if (approved) {
          const sha = await commitAll(cwd, `agent(${task.id}): ${task.title}\n\nAttempts: ${attempt}. Checks: ${[...gate, ...finalChecks].join(', ')}.`);
          await outcome('passed', sha ? sha.slice(0, 10) : 'no diff');
          await state.patch(task.id, { status: 'done', lease: undefined, lastFailure: undefined, commit: sha });
          await finish('done', { commit: sha, provider: providerName, model: provider.model, attempts: attempt });
          // The branch keeps the work; the worktree is only disk space now.
          if (config.worktree.removeWhenDone) await removeWorktree(config, task.id).catch(() => {});
          const report = writeReport(config, task, state.task(task.id), [`- Commit: \`${sha}\``, `- Screenshots: ${result.screenshots.length}`]);
          events.emit('task.done', { task: task.id, attempt, message: `passed; review ${path.relative(config.root, report)}` });
          return 'done';
        }
      }
    } catch (err) {
      if (signal.aborted) break;
      if (!err.kind && !(err instanceof ProviderError)) {
        // A harness or git failure, not a model mistake: stop rather than spin.
        await outcome('error', err.message);
        await state.patch(task.id, { status: 'blocked', lastError: err.message, lease: undefined });
        await finish('blocked');
        writeReport(config, task, state.task(task.id), [`- Error: ${err.message}`]);
        events.emit('task.blocked', { task: task.id, attempt, message: err.message.split('\n')[0] });
        return 'blocked';
      }
      failure = `### ${err.kind ?? 'provider error'}\n${err.message}`;
      await outcome(err.kind ?? 'provider-error', err.message.split('\n')[0]);
      await state.patch(task.id, { lastFailure: failure });
    }

    if (attempt < maxAttempts) {
      const waitMs = backoffDelay(attempt - startAttempt + 1, config.waitsMs.betweenAttempts);
      events.emit('task.wait', { task: task.id, attempt, message: `retrying in ${formatDuration(waitMs)}` });
      try { await sleep(waitMs, signal); } catch { break; }
    }
  }

  if (signal.aborted) {
    await state.patch(task.id, { status: 'pending', lease: undefined });
    await coordinator.release(task.id, owner).catch(() => {});
    events.emit('task.paused', { task: task.id, message: 'stopped; will resume next run' });
    return 'paused';
  }
  await state.patch(task.id, { status: 'blocked', lease: undefined });
  await finish('blocked');
  const report = writeReport(config, task, state.task(task.id), ['- Needs a person: the last failure is in the table and in state.json (lastFailure).']);
  events.emit('task.blocked', { task: task.id, message: `gave up after ${maxAttempts} attempts; see ${path.relative(config.root, report)}` });
  return 'blocked';
}
