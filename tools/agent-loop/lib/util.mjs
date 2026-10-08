// Small building blocks the rest of the harness shares: waiting, backoff,
// durations, concurrency limits and request pacing. No dependencies.

/** Wait `ms`, or reject early if `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const timer = setTimeout(done, Math.max(0, ms));
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** "500ms", "30s", "5m", "1h", or a number of milliseconds. */
export function parseDuration(value, fallbackMs = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return fallbackMs;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/i.exec(value);
  if (!match) throw new Error(`Not a duration: "${value}" (use e.g. 500ms, 30s, 5m, 1h)`);
  const unit = (match[2] ?? 'ms').toLowerCase();
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  return Math.round(Number(match[1]) * scale);
}

export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h${Math.round((ms % 3_600_000) / 60_000)}m`;
}

/**
 * Exponential backoff with "full jitter": a random wait between half and all of
 * base * 2^(attempt-1), capped at max. Jitter keeps a flood of agents that all
 * failed at once from all retrying at once.
 */
export function backoffDelay(attempt, { baseMs = 2000, maxMs = 120_000, jitter = true } = {}, random = Math.random) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return jitter ? Math.round(ceiling / 2 + random() * (ceiling / 2)) : ceiling;
}

/** Last `maxChars` of text, keeping whole lines, so failure output fits in a prompt. */
export function tail(text, maxChars = 6000) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return value;
  const cut = value.slice(value.length - maxChars);
  const newline = cut.indexOf('\n');
  return `…(${value.length - maxChars} earlier characters trimmed)\n${newline >= 0 ? cut.slice(newline + 1) : cut}`;
}

/** Replace ${NAME} and ${NAME:-default} from `env`. */
export function expandEnv(value, env = process.env) {
  return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_, name, fallback) => env[name] ?? fallback ?? '');
}

/** Ensure a host string has a URL scheme. Ollama's own OLLAMA_HOST env var
    convention is scheme-less (e.g. "127.0.0.1:11434", for binding), but our
    config reuses the same env var name expecting a full fetch URL — if a
    machine has OLLAMA_HOST set for Ollama itself, expandEnv happily
    substitutes it in verbatim and the resulting "host" has no scheme,
    which fetch()/new URL() then reject outright. */
export function normalizeHost(value, fallback) {
  const v = (value || fallback || '').trim();
  if (!v) return v;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`;
}

/** Limit how many callers run at once. */
export function createSemaphore(limit) {
  let active = 0;
  const queue = [];
  const max = Math.max(1, limit | 0);
  return {
    get active() { return active; },
    get waiting() { return queue.length; },
    async run(fn) {
      if (active >= max) await new Promise(resolve => queue.push(resolve));
      active++;
      try {
        return await fn();
      } finally {
        active--;
        queue.shift()?.();
      }
    },
  };
}

/**
 * Pace requests to one provider: at most `perMinute` in any rolling minute and
 * at least `minIntervalMs` apart. `take()` resolves when the caller may send.
 */
export function createRateLimiter({ perMinute = 0, minIntervalMs = 0 } = {}, clock = { now: Date.now, sleep }) {
  const sent = [];
  let last = -Infinity;
  let chain = Promise.resolve();
  const take = async (signal) => {
    for (;;) {
      const now = clock.now();
      while (sent.length && now - sent[0] >= 60_000) sent.shift();
      let waitMs = Math.max(0, last + minIntervalMs - now);
      if (perMinute > 0 && sent.length >= perMinute) waitMs = Math.max(waitMs, sent[0] + 60_000 - now);
      if (waitMs <= 0) {
        last = now;
        sent.push(now);
        return;
      }
      await clock.sleep(waitMs, signal);
    }
  };
  return {
    // Serialize so two callers can't both see the same free slot.
    take(signal) {
      const next = chain.then(() => take(signal));
      chain = next.catch(() => {});
      return next;
    },
  };
}

/** Minimal glob → RegExp: `**` any depth, `*` within a segment, `?` one character. */
export function globToRegExp(glob) {
  let source = '';
  const text = glob.replace(/\\/g, '/');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '*' && text[i + 1] === '*') {
      i++;
      if (text[i + 1] === '/') { i++; source += '(?:.*/)?'; } else source += '.*';
    } else if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(path, globs) {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return globs.some(glob => globToRegExp(glob).test(normalized));
}
