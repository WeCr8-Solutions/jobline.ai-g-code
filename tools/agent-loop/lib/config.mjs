// agent-loop.config.json: what to check, which models to use for which job,
// and how long to wait. Everything an agent may run comes from this file.

import fs from 'node:fs';
import path from 'node:path';
import { expandEnv, parseDuration } from './util.mjs';

export const CONFIG_FILE = 'agent-loop.config.json';

/** Paths no agent may change, whatever the config says. */
export const ALWAYS_DENIED = [
  '.git/**', '**/.git/**', 'node_modules/**', '**/node_modules/**',
  '.agent-loop/**', CONFIG_FILE, 'tools/agent-loop/**', '.github/**',
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key',
];

const DEFAULTS = {
  tasksDir: 'agent-tasks',
  concurrency: 3,
  checkConcurrency: 2,
  gate: [],
  checks: {},
  providers: {},
  roles: {},
  edits: { allow: ['src/**', 'test/**'], deny: [] },
  context: { maxFileBytes: 60_000, maxContextBytes: 300_000, instructions: '', alwaysInclude: [] },
  waits: {
    betweenAttempts: { base: '20s', max: '10m' },
    providerRetry: { base: '5s', max: '5m', retries: 5 },
    poll: '30s',
    lease: '45m',
    gateInterval: '15m',
    heartbeat: '5m',
  },
  worktree: { base: 'HEAD', linkNodeModules: true, setup: [], removeWhenDone: true },
  task: { maxAttempts: 5, review: false, finalChecks: [] },
  artifacts: { screenshotDirs: [] },
  host: { name: '', tags: '' },
  // Claims and heartbeats live under refs/heads/ (as branches): every git host
  // and proxy accepts branch pushes, while some refuse custom ref namespaces.
  coordination: { mode: 'local', remote: 'origin', refPrefix: 'refs/heads/agent-claims/', pushBranches: true, taskBranch: 'agent-queue' },
  monitoring: { publish: 'auto', refPrefix: 'refs/heads/agent-hosts/' },
  limits: { minFreeDiskGb: 5, maxRuntime: '', until: '', restartEvery: '' },
  autoTasks: { enabled: false, maxOpen: 5, review: false },
};

function merge(base, override) {
  if (Array.isArray(override) || typeof override !== 'object' || override === null) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base && typeof base[key] === 'object' && !Array.isArray(base[key]) && base[key] !== null
      ? merge(base[key], value)
      : value;
  }
  return out;
}

function expandStrings(value, env) {
  if (typeof value === 'string') return expandEnv(value, env);
  if (Array.isArray(value)) return value.map(item => expandStrings(item, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandStrings(item, env)]));
  }
  return value;
}

/** Load and validate the config. Throws with every problem listed at once. */
export function loadConfig(root, { file = CONFIG_FILE, env = process.env } = {}) {
  const filePath = path.resolve(root, file);
  if (!fs.existsSync(filePath)) throw new Error(`No ${file} in ${root}. Copy tools/agent-loop/README.md's example to start.`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  const config = expandStrings(merge(DEFAULTS, raw), env);
  config.root = path.resolve(root);
  config.stateDir = path.join(config.root, '.agent-loop');

  const problems = [];
  for (const [name, check] of Object.entries(config.checks)) {
    if (typeof check === 'string') config.checks[name] = { run: check };
    else if (!check || typeof check.run !== 'string') problems.push(`checks.${name} needs a "run" command`);
  }
  for (const name of config.gate) if (!config.checks[name]) problems.push(`gate lists "${name}" but checks has no such entry`);
  for (const name of config.task.finalChecks ?? []) if (!config.checks[name]) problems.push(`task.finalChecks lists "${name}" but checks has no such entry`);
  if (!['local', 'git'].includes(config.coordination.mode)) problems.push('coordination.mode must be "local" or "git"');
  for (const [name, provider] of Object.entries(config.providers)) {
    if (!provider?.type) problems.push(`providers.${name} needs a "type"`);
  }
  for (const [role, spec] of Object.entries(config.roles)) {
    const list = [].concat(spec?.providers ?? spec?.provider ?? []);
    if (!list.length) problems.push(`roles.${role} needs "providers"`);
    for (const name of list) if (!config.providers[name]) problems.push(`roles.${role} uses unknown provider "${name}"`);
  }
  try {
    config.waitsMs = {
      betweenAttempts: { baseMs: parseDuration(config.waits.betweenAttempts.base), maxMs: parseDuration(config.waits.betweenAttempts.max) },
      providerRetry: {
        baseMs: parseDuration(config.waits.providerRetry.base),
        maxMs: parseDuration(config.waits.providerRetry.max),
        retries: Number(config.waits.providerRetry.retries ?? 5),
      },
      pollMs: parseDuration(config.waits.poll),
      leaseMs: parseDuration(config.waits.lease),
      gateIntervalMs: parseDuration(config.waits.gateInterval),
      heartbeatMs: parseDuration(config.waits.heartbeat ?? '5m'),
    };
    config.limitsMs = {
      maxRuntimeMs: config.limits.maxRuntime ? parseDuration(config.limits.maxRuntime) : undefined,
      restartEveryMs: config.limits.restartEvery ? parseDuration(config.limits.restartEvery) : undefined,
    };
    config.limits.minFreeDiskGb = Number(config.limits.minFreeDiskGb ?? 5);
    for (const check of Object.values(config.checks)) check.timeoutMs = parseDuration(check.timeout ?? '10m');
  } catch (err) {
    problems.push(err.message);
  }
  if (problems.length) throw new Error(`${file} has problems:\n  - ${problems.join('\n  - ')}`);
  config.edits.deny = [...ALWAYS_DENIED, ...(config.edits.deny ?? [])];
  return config;
}
