// Model providers. Each one answers `complete({system, prompt, images, cwd})`.
//
//   ollama       local models through Ollama (/api/chat)
//   openai       any OpenAI-compatible server: LM Studio, llama.cpp, vLLM,
//                OpenRouter, a hosted gateway
//   anthropic    Claude through the official @anthropic-ai/sdk, loaded only
//                when this provider is used, so local-only setups stay
//                dependency-free
//   claude-code  the Claude Code CLI in headless mode; edits files itself
//   command      any CLI (aider, a codex wrapper, a shell script) that takes the
//                prompt on stdin or from {promptFile}
//
// "diff" providers return a patch the harness applies; "agentic" providers
// edit the worktree, and the harness reverts anything outside the allowed paths.
// Every provider is paced (requests per minute, minimum gap), limited in
// concurrency, and retried with backoff on rate limits and server errors.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from './exec.mjs';
import { backoffDelay, createRateLimiter, createSemaphore, parseDuration, sleep } from './util.mjs';

export class ProviderError extends Error {
  constructor(message, { retryable = false, retryAfterMs, status } = {}) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

function retryAfterMs(headers) {
  const value = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function postJson(url, body, { headers = {}, timeoutMs, signal }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ProviderError(`${url} unreachable: ${err.message}`, { retryable: true });
  }
  const text = await response.text();
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    throw new ProviderError(`${url} returned ${response.status}: ${text.slice(0, 500)}`, {
      retryable, status: response.status, retryAfterMs: retryAfterMs(response.headers),
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(`${url} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

const imageBase64 = (file) => fs.readFileSync(file).toString('base64');
const imageMime = (file) => (/\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg');

function ollama(spec) {
  const host = (spec.host || 'http://localhost:11434').replace(/\/$/, '');
  return {
    mode: 'diff',
    async complete({ system, prompt, images = [], signal }) {
      const json = await postJson(`${host}/api/chat`, {
        model: spec.model,
        stream: false,
        options: { temperature: spec.temperature ?? 0.2, num_ctx: spec.contextTokens ?? 32768 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt, ...(images.length ? { images: images.map(imageBase64) } : {}) },
        ],
      }, { timeoutMs: spec.timeoutMs, signal });
      return { text: json.message?.content ?? '' };
    },
  };
}

function openaiCompatible(spec) {
  const base = (spec.baseUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
  const key = spec.apiKeyEnv ? process.env[spec.apiKeyEnv] : undefined;
  return {
    mode: 'diff',
    async complete({ system, prompt, images = [], signal }) {
      const content = images.length
        ? [{ type: 'text', text: prompt }, ...images.map(file => ({
          type: 'image_url', image_url: { url: `data:${imageMime(file)};base64,${imageBase64(file)}` },
        }))]
        : prompt;
      const json = await postJson(`${base}/chat/completions`, {
        model: spec.model,
        temperature: spec.temperature ?? 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
      }, { headers: key ? { authorization: `Bearer ${key}` } : {}, timeoutMs: spec.timeoutMs, signal });
      return { text: json.choices?.[0]?.message?.content ?? '' };
    },
  };
}

function anthropic(spec) {
  if (!spec.model) {
    throw new ProviderError('anthropic provider needs "model" (e.g. "${JOBLINE_AGENT_CLAUDE_MODEL}" with that variable set)');
  }
  let clientPromise;
  const client = () => (clientPromise ??= import('@anthropic-ai/sdk').then(
    ({ default: Anthropic }) => ({ Anthropic, client: new Anthropic({ maxRetries: 2, timeout: spec.timeoutMs }) }),
    () => { throw new ProviderError('anthropic provider needs the SDK: npm install --save-dev @anthropic-ai/sdk'); },
  ));
  return {
    mode: 'diff',
    async complete({ system, prompt, images = [], signal }) {
      const { Anthropic, client: api } = await client();
      const content = [
        ...images.map(file => ({ type: 'image', source: { type: 'base64', media_type: imageMime(file), data: imageBase64(file) } })),
        { type: 'text', text: prompt },
      ];
      const params = {
        model: spec.model,
        max_tokens: spec.maxTokens ?? 64000,
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort: spec.effort ?? 'high' },
      };
      // Server-side refusal fallback ("default" routing). Turn off with "fallbacks": false.
      if (spec.fallbacks !== false) {
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
      }
      let message;
      try {
        message = await api.beta.messages.stream(params, { signal }).finalMessage();
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof Anthropic.RateLimitError) {
          throw new ProviderError('Claude rate limit', { retryable: true, status: 429, retryAfterMs: retryAfterMs(err.headers) });
        }
        if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
          throw new ProviderError(`Claude unavailable: ${err.message}`, { retryable: true, status: err.status });
        }
        if (err instanceof Anthropic.APIError) throw new ProviderError(`Claude API ${err.status}: ${err.message}`, { status: err.status });
        throw err;
      }
      if (message.stop_reason === 'refusal') {
        throw new ProviderError(`Claude declined this task (${message.stop_details?.category ?? 'no category'})`);
      }
      const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      return { text, truncated: message.stop_reason === 'max_tokens', usage: message.usage };
    },
  };
}

function claudeCode(spec) {
  const tools = spec.allowedTools ?? 'Read,Edit,Write,Glob,Grep';
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', JSON.stringify(tools)];
  if (spec.model) args.push('--model', JSON.stringify(spec.model));
  if (spec.maxTurns) args.push('--max-turns', String(spec.maxTurns));
  return {
    mode: 'agentic',
    async complete({ system, prompt, cwd, signal }) {
      const result = await runCommand(`${spec.bin ?? 'claude'} ${args.join(' ')}`, {
        cwd, timeoutMs: spec.timeoutMs, signal, input: `${system}\n\n${prompt}`,
      });
      if (!result.ok) {
        throw new ProviderError(`claude CLI exited ${result.code}${result.timedOut ? ' (timed out)' : ''}: ${result.output.slice(-800)}`, {
          retryable: /rate.?limit|overloaded|429|5\d\d/i.test(result.output),
        });
      }
      try {
        const json = JSON.parse(result.output.slice(result.output.indexOf('{')));
        if (json.is_error) throw new ProviderError(`claude CLI reported an error: ${json.result ?? ''}`);
        return { text: String(json.result ?? '') };
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        return { text: result.output };
      }
    },
  };
}

function command(spec) {
  if (!spec.run) throw new ProviderError('command provider needs "run"');
  return {
    mode: spec.mode === 'agentic' ? 'agentic' : 'diff',
    async complete({ system, prompt, cwd, signal }) {
      const text = `${system}\n\n${prompt}`;
      const promptFile = path.join(os.tmpdir(), `agent-loop-${process.pid}-${Date.now()}.md`);
      fs.writeFileSync(promptFile, text);
      try {
        const usesFile = spec.run.includes('{promptFile}');
        const result = await runCommand(spec.run.replaceAll('{promptFile}', JSON.stringify(promptFile)).replaceAll('{cwd}', JSON.stringify(cwd)), {
          cwd, timeoutMs: spec.timeoutMs, signal, input: usesFile ? undefined : text, env: spec.env,
        });
        if (!result.ok) throw new ProviderError(`command provider exited ${result.code}: ${result.output.slice(-800)}`, { retryable: Boolean(spec.retryOnFailure) });
        return { text: result.output };
      } finally {
        fs.rmSync(promptFile, { force: true });
      }
    },
  };
}

const FACTORIES = { ollama, openai: openaiCompatible, anthropic, 'claude-code': claudeCode, command };

/**
 * Build every configured provider, each wrapped with its own pacing,
 * concurrency limit and retry loop.
 */
export function createProviders(config, events, { factories = FACTORIES, clock } = {}) {
  const providers = {};
  for (const [name, raw] of Object.entries(config.providers)) {
    const factory = factories[raw.type];
    if (!factory) throw new Error(`providers.${name}: unknown type "${raw.type}" (use ${Object.keys(FACTORIES).join(', ')})`);
    const spec = { ...raw, timeoutMs: parseDuration(raw.timeout ?? '15m') };
    let inner;
    const build = () => (inner ??= factory(spec));
    const limiter = createRateLimiter({
      perMinute: raw.requestsPerMinute ?? 0,
      minIntervalMs: parseDuration(raw.minInterval ?? 0),
    }, clock);
    const slots = createSemaphore(raw.concurrency ?? 2);
    const { baseMs, maxMs, retries } = config.waitsMs.providerRetry;
    providers[name] = {
      name,
      get mode() { return build().mode; },
      vision: Boolean(raw.vision),
      async complete(request) {
        for (let attempt = 1; ; attempt++) {
          await limiter.take(request.signal);
          try {
            const started = Date.now();
            const result = await slots.run(() => build().complete(request));
            events?.emit('provider.reply', { task: request.task, attempt: request.attempt, provider: name, durationMs: Date.now() - started, chars: result.text.length });
            return result;
          } catch (err) {
            if (request.signal?.aborted || !(err instanceof ProviderError) || !err.retryable || attempt > retries) throw err;
            const waitMs = Math.max(err.retryAfterMs ?? 0, backoffDelay(attempt, { baseMs, maxMs }));
            events?.emit('provider.wait', { task: request.task, attempt: request.attempt, provider: name, waitMs, message: `${err.message.slice(0, 120)} - retrying in ${Math.round(waitMs / 1000)}s` });
            await (clock?.sleep ?? sleep)(waitMs, request.signal);
          }
        }
      },
    };
  }
  return providers;
}

/** Quick reachability check for `providers` command. */
export async function pingProvider(config, name) {
  const spec = config.providers[name];
  if (spec.type === 'ollama') {
    const host = (spec.host || 'http://localhost:11434').replace(/\/$/, '');
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    const found = (json.models ?? []).some(m => m.name === spec.model || m.model === spec.model);
    return found ? `ok (${spec.model} installed)` : `reachable, but ${spec.model} is not pulled (ollama pull ${spec.model})`;
  }
  if (spec.type === 'openai') {
    const base = (spec.baseUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
    const key = spec.apiKeyEnv ? process.env[spec.apiKeyEnv] : undefined;
    const res = await fetch(`${base}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(5000) });
    return res.ok ? 'ok' : `HTTP ${res.status}`;
  }
  if (spec.type === 'anthropic') {
    try {
      await import('@anthropic-ai/sdk');
    } catch {
      return 'SDK missing: npm install --save-dev @anthropic-ai/sdk';
    }
    return spec.model ? `SDK present, model ${spec.model}` : 'no model set';
  }
  if (spec.type === 'claude-code') {
    const result = await runCommand(`${spec.bin ?? 'claude'} --version`, { cwd: config.root, timeoutMs: 15_000 });
    return result.ok ? `ok (${result.output.trim()})` : 'claude CLI not found';
  }
  return 'not checked (command provider)';
}
