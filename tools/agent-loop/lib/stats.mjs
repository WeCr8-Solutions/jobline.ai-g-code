// Which models actually do the work. Every attempt is recorded in
// .agent-loop/stats.jsonl (provider, model, role, outcome, how long the model
// took); `stats` summarises it, heartbeats carry the summary so `monitor` can
// compare models across computers, and a role with `adaptive: true` tries its
// providers in order of measured success instead of config order.

import fs from 'node:fs';
import path from 'node:path';

const ROTATE_BYTES = 20 * 1024 * 1024;

export function statsFile(stateDir) {
  return path.join(stateDir, 'stats.jsonl');
}

export function recordAttempt(stateDir, record) {
  const file = statsFile(stateDir);
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  } catch { /* stats must never stop an agent */ }
}

export function readAttempts(stateDir, { sinceMs } = {}) {
  const out = [];
  for (const file of [`${statsFile(stateDir)}.1`, statsFile(stateDir)]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (!sinceMs || Date.parse(r.at) >= sinceMs) out.push(r);
      } catch { /* skip a torn line */ }
    }
  }
  return out;
}

/** Outcomes that mean the model's reply wasn't usable at all. */
const UNUSABLE = new Set(['no-change', 'apply-failed', 'refused-paths', 'provider-error']);

/**
 * One row per provider+model(+role): attempts, passes, pass rate, how often
 * the reply was unusable, median model time, and tasks finished.
 */
export function summarize(records, { byRole = false } = {}) {
  const rows = new Map();
  for (const r of records) {
    const key = [r.provider, r.model ?? '', byRole ? r.role : ''].join('|');
    const row = rows.get(key) ?? {
      provider: r.provider, model: r.model ?? '', role: byRole ? r.role : undefined, hosts: new Set(),
      attempts: 0, passes: 0, checkFailures: 0, unusable: 0, reviewRejects: 0, modelMs: [], tasks: new Set(),
    };
    row.attempts++;
    if (r.host) row.hosts.add(r.host);
    if (r.outcome === 'passed') { row.passes++; row.tasks.add(r.task); }
    else if (r.outcome === 'checks-failed') row.checkFailures++;
    else if (r.outcome === 'review-changes') row.reviewRejects++;
    else if (UNUSABLE.has(r.outcome)) row.unusable++;
    if (typeof r.modelMs === 'number') row.modelMs.push(r.modelMs);
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => {
    const sorted = row.modelMs.sort((a, b) => a - b);
    return {
      provider: row.provider, model: row.model, role: row.role, hosts: [...row.hosts].sort(),
      attempts: row.attempts, passes: row.passes, tasksDone: row.tasks.size,
      passRate: row.attempts ? row.passes / row.attempts : 0,
      unusableRate: row.attempts ? row.unusable / row.attempts : 0,
      checkFailures: row.checkFailures, reviewRejects: row.reviewRejects,
      medianModelSeconds: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] / 100) / 10 : null,
      score: smoothedScore(row.passes, row.attempts),
    };
  }).sort((a, b) => b.score - a.score || b.attempts - a.attempts);
}

/** Pass rate with a prior of two passes in four tries, so a 1-for-1 newcomer doesn't outrank a proven 40-for-60. */
export function smoothedScore(passes, attempts) {
  return (passes + 2) / (attempts + 4);
}

/** Merge summaries from several computers (heartbeats) into one table. */
export function mergeSummaries(lists) {
  const rows = new Map();
  for (const row of lists.flat()) {
    const key = [row.provider, row.model, row.role ?? ''].join('|');
    const into = rows.get(key) ?? { ...row, hosts: [], attempts: 0, passes: 0, tasksDone: 0, checkFailures: 0, reviewRejects: 0, unusable: 0 };
    into.hosts = [...new Set([...into.hosts, ...(row.hosts ?? [])])].sort();
    into.attempts += row.attempts;
    into.passes += row.passes;
    into.tasksDone += row.tasksDone;
    into.checkFailures += row.checkFailures ?? 0;
    into.reviewRejects += row.reviewRejects ?? 0;
    into.unusable += Math.round((row.unusableRate ?? 0) * row.attempts);
    rows.set(key, into);
  }
  return [...rows.values()].map(row => ({
    ...row,
    passRate: row.attempts ? row.passes / row.attempts : 0,
    unusableRate: row.attempts ? row.unusable / row.attempts : 0,
    score: smoothedScore(row.passes, row.attempts),
  })).sort((a, b) => b.score - a.score || b.attempts - a.attempts);
}

/**
 * Order a role's providers by measured success. Providers with fewer than
 * `minSamples` attempts keep their config position, so new models still get
 * tried rather than starved.
 */
export function rankProviders(names, records, role, { minSamples = 6, models = {} } = {}) {
  const table = summarize(records.filter(r => r.role === role || role === undefined));
  const score = (name) => {
    const row = table.find(r => r.provider === name && (!models[name] || r.model === models[name]));
    return row && row.attempts >= minSamples ? row.score : undefined;
  };
  const measured = names.filter(n => score(n) !== undefined).sort((a, b) => score(b) - score(a));
  const result = [...names];
  // Measured providers swap among their own positions; unmeasured stay put.
  const slots = names.map((n, i) => (score(n) !== undefined ? i : -1)).filter(i => i >= 0);
  slots.forEach((slot, i) => { result[slot] = measured[i]; });
  return result;
}

export function formatTable(rows) {
  const head = ['PROVIDER', 'MODEL', 'ROLE', 'ATTEMPTS', 'PASS', 'PASS%', 'UNUSABLE%', 'MEDIAN s', 'TASKS', 'HOSTS'];
  const body = rows.map(r => [
    r.provider, r.model || '-', r.role ?? '-', String(r.attempts), String(r.passes),
    `${Math.round(r.passRate * 100)}`, `${Math.round(r.unusableRate * 100)}`,
    r.medianModelSeconds == null ? '-' : String(r.medianModelSeconds), String(r.tasksDone), (r.hosts ?? []).join(','),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  return [head, ...body].map(cols => cols.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n');
}
