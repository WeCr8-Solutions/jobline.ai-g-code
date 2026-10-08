# JobLine agent loop

A reusable harness that lets many coding agents (local models, Claude, or any
CLI agent) work on queued tasks in parallel. Each agent develops, gets checked,
and is corrected until its change passes, and nothing is merged without a
person. The same folder is used in `jobline.ai-g-code` and `jobline.ai-CAM`;
only `agent-loop.config.json` and `agent-tasks/` differ between them.

It needs Node 20 or later and git. Nothing else is required unless you use the
Claude API provider, which loads `@anthropic-ai/sdk`.

## Quick start

```bash
npm run agent -- providers          # which models are reachable
npm run agent -- new "Cover decimal travel input" --role test
# edit agent-tasks/cover-decimal-travel-input.md: instructions + files
npm run agent:run                   # work the queue, then stop
npm run agent:status                # what happened (add --watch for a live view)
git log agent/cover-decimal-travel-input   # review, then merge like any branch
```

## How a task runs

```mermaid
flowchart LR
  Q[agent-tasks/*.md] --> C{claim lease}
  C --> W[worktree on agent/&lt;id&gt;]
  W --> M[ask model]
  M --> A[apply diff / police edits]
  A --> G[run gate + screenshots]
  G -->|pass| R{review?}
  R -->|approve or off| D[commit on agent branch + report]
  R -->|changes| F
  G -->|fail| F[wait with backoff,<br/>feed failure back]
  A -->|bad diff / bad paths| F
  F -->|attempts left| M
  F -->|out of attempts| B[blocked + report]
```

- **Isolation.** Every task gets its own git worktree under `.agent-loop/worktrees/`
  and its own branch `agent/<id>`. The main checkout is never touched. Worktrees
  share the main `node_modules` through a link, so a flood of agents doesn't
  run a flood of installs.
- **Models never run commands.** In `diff` mode a model returns a unified
  diff. The harness checks every path in it against `edits.allow`/`edits.deny`
  and applies it with `git apply --recount`, which repairs the wrong hunk counts
  small models often write. In `agentic` mode (Claude Code CLI, aider and
  similar) the agent edits the worktree itself, and the harness reverts anything
  outside the allowed paths before running checks. Checks only come from the
  config. The harness, the config, `.git`, `.github`, `node_modules` and
  `.env`/key files can never be changed.
- **Correction.** A failed check's name and output tail go into the next
  prompt, along with the change so far. Prompts tell the model not to weaken
  tests.
- **Escalation.** A role lists providers in order, e.g. `["local", "claude"]`
  with `escalateAfter: 2`: two tries on the free local model, then the stronger
  one.
- **Review.** With `review: true` (per task or in `task.review`), a reviewer
  model sees the final diff and the screenshots, and must answer
  `VERDICT: APPROVE`. Anything else is treated as changes requested and fed back.
- **Reports.** `.agent-loop/reports/<id>.md` has one row per attempt.
  `.agent-loop/events.jsonl` logs every step for dashboards or `tail -f`.

## Waits and pacing

| Setting | Default | What it controls |
| --- | --- | --- |
| `waits.betweenAttempts` | 20s → 10m | Exponential backoff with jitter between a task's attempts, so a flood that fails together doesn't retry together |
| `waits.providerRetry` | 5s → 5m, 5 retries | Retries on 429/5xx/connection errors. A server's `Retry-After` always wins if it's longer |
| `providers.<n>.requestsPerMinute` | none | Rolling one-minute cap per provider |
| `providers.<n>.minInterval` | 0 | Minimum gap between requests to one provider |
| `providers.<n>.concurrency` | 2 | Requests in flight per provider (set `1` for a single local GPU) |
| `concurrency` | 3 | Tasks worked at once |
| `checkConcurrency` | 2 | Gate runs at once across all agents, so ten agents don't all run `npm test` together |
| `checks.<n>.timeout` | 10m | The process tree is killed past this |
| `waits.lease` | 45m | A crashed worker's task returns to the queue after this |
| `waits.poll` | 30s | How often `run --watch` looks for new or newly unblocked tasks |
| `waits.gateInterval` | 15m | Interval for `gate --watch` (the CI loop) |

Ctrl+C stops cleanly: running tasks go back to pending and resume at their
next attempt on the next run. A second Ctrl+C exits immediately. Each kind of
loop (`run`, `gate`) takes a lock, so two copies can't run at once in the same
checkout.

## Providers

| `type` | For | Mode | Notes |
| --- | --- | --- | --- |
| `lmstudio` | LM Studio's local server | diff | `host`/`hosts` (default `http://localhost:1234`), `model`. Turn on the server (Developer tab) and either load the model or enable Just-in-Time loading. `providers` lists what's loaded |
| `ollama` | Local models through Ollama | diff | `host`/`hosts`, `model`, `contextTokens`; set `vision: true` for a vision model used as reviewer |
| `openai` | llama.cpp server, vLLM, OpenRouter, any other OpenAI-compatible gateway | diff | `baseUrl`/`hosts`, `model`, `apiKeyEnv` |
| `anthropic` | Claude API | diff | Install `@anthropic-ai/sdk` and set `model` (the config reads `JOBLINE_AGENT_CLAUDE_MODEL`). `effort`, `maxTokens`, `vision`. Server-side refusal fallback is on unless `"fallbacks": false` |
| `claude-code` | Claude Code CLI, headless | agentic | Uses your `claude` login. `allowedTools` defaults to file tools only, with no shell |
| `command` | Anything else (aider, a codex wrapper, your own script) | `diff` or `agentic` | `run` gets the prompt on stdin, or as a file via `{promptFile}` |

Only tasks whose role reaches a provider ever call it, so a machine with only
LM Studio or Ollama works with the default config until a task escalates.
The default roles try LM Studio twice, then Ollama twice, then Claude.

## Several computers

Two separate things can be spread out, and they combine.

**Model servers.** Give a local provider several `hosts`, as a list or a
comma-separated string, so it can come from an environment variable:

```bash
LMSTUDIO_HOSTS=http://gpu-1:1234,http://gpu-2:1234,http://localhost:1234
```

Requests go to the least busy host (`concurrencyPerHost` each). A host that
stops answering is rested for `hostCooldown` while the others carry on.

**Workers.** Any number of computers can work one queue. Each runs the loop
in its own clone of the repo, with:

```bash
JOBLINE_AGENT_QUEUE=git        # share the queue through the git remote
JOBLINE_AGENT_HOST=bench-2     # name shown in status and claims (default: hostname)
JOBLINE_AGENT_TAGS=gpu,vscode  # what this computer can do (its OS is added automatically)
npm run agent:watch
```

A computer claims a task by creating `refs/agent-claims/<id>` on the remote.
Git refuses to create a ref that already exists, so two computers can't take
the same task, and no extra server is needed. Leases are renewed every
attempt. If a computer goes quiet, its task returns to the queue when the
lease (`waits.lease`) runs out. Finished branches are pushed as `agent/<id>`,
and `status` shows the shared queue.

A task with `runsOn: [windows]` only goes to computers with that tag. Use it
for checks that need a particular OS or tool, for example the VS Code visual
tests or Playwright baselines kept per platform. If your git host doesn't
accept custom refs, set `coordination.refPrefix` to `refs/heads/agent-claims/`.

## Problems become tasks

With `autoTasks.enabled` (or `gate --file-tasks`), a failing gate on the main
checkout writes `agent-tasks/auto-gate-<check>.md` with the failure output.
The repo files the output mentions are listed in it. A check can also report
findings that don't fail it: it writes JSON to the path in
`AGENT_LOOP_ISSUES_FILE`, and each finding becomes `auto-<check>-<key>.md`.
CAM's machine test bench uses this to turn module findings into fix tasks.

- Findings already queued are refreshed, not duplicated.
- A finding that comes back after its task was done reopens the task (a
  regression).
- A blocked task stays blocked until a person runs `reset`, so a problem the
  agents can't fix doesn't use model time on every gate run.
- `autoTasks.maxOpen` caps how many open at once; the rest are filed as those
  finish.

## Regression baselines and slow checks

`task.finalChecks` (e.g. `["view", "build"]`) run only after a task's gate
passes, so slow checks don't run on every attempt. A check with `updateEnv`
(e.g. `{"UPDATE_GOLDEN": "1"}`) runs with those variables for tasks marked
`updateGoldens: true`. The refreshed baselines are committed with the change,
so the reviewer sees the code diff and the output diff together. Deny the
baseline files in `edits.deny` so agents can't edit them directly.

## Screenshots

Mark a check with `"screenshots": true` and `"screenshotDirs": [...]`. Images
that check writes are copied to `.agent-loop/artifacts/<task>/attempt-N/` and
handed to a vision-capable reviewer. In this repo the `visual` check wraps
`npm run test:e2e:visual` (VS Code webview captures). In CAM it wraps the
Playwright e2e specs.

## The CI loop

`npm run agent:gate` runs the configured gate once on the main checkout.
`npm run agent:gate -- --watch` repeats it every `waits.gateInterval` (it
replaces CAM's old `ci-automation-loop.cjs`). Results go into `state.json` and
show in `status`.

## Commands

```
run [--watch] [--only a,b] [--concurrency N]   work the queue
gate [--watch] [--checks a,b]                  run checks on the main checkout
status [--watch]                               tasks, gate result, recent events
new "Title" [--role develop|test|fix]          scaffold a task file
providers                                      reachability of each provider
reset [id] [--remove-worktree] [--delete-branch]  forget state so a task runs again
```

All commands take `--root <dir>` and `--config <file>`.

## Writing a good task

```markdown
---
id: preset-travel-tests        # branch becomes agent/preset-travel-tests
title: Cover more machine travel input formats
role: test                     # develop | test | fix, or any role in the config
files: [src/presets/presetLibrary.ts, test/machine-presets.test.ts]   # paths or globs shown to the model
checks: [typecheck, unit]      # defaults to the config's gate
maxAttempts: 4
review: true                   # optional reviewer pass
dependsOn: [other-task]        # wait for another task to finish
runsOn: [windows]              # only computers with these tags
updateGoldens: true            # refresh regression baselines for review
priority: 10                   # higher runs first
enabled: false                 # park it
---
What to change, what "done" means, and what must not change.
```

Keep tasks small. One behaviour per task lets a local model finish it and
keeps each branch easy to review. List the files the change needs; anything
not listed is invisible to `diff`-mode models.

## Tests

`npm run test:agent-loop` covers waits, pacing, locks, leases, parsing and
path safety. It also runs end-to-end loops in scratch git repos with scripted
models:
- fail, then fix with escalation and review
- refused paths
- an agentic CLI provider
- the CI gate
- LM Studio against a fake local server, and host failover
- two clones sharing a queue through a bare remote, where every task finishes
  exactly once
- filed and reopened fix tasks
- final checks with baseline refresh
