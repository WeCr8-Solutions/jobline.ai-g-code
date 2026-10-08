#!/usr/bin/env bash
# Supervised agent loop for macOS and Linux. Run from anywhere:
#   tools/agent-loop/supervisor/start.sh            # foreground
#   nohup tools/agent-loop/supervisor/start.sh &    # background
# Stop it with: touch .agent-loop/STOP   (or tools/agent-loop/supervisor/stop.sh)
#
# Restarts the loop after a crash (backing off), updates the code with
# `git pull --ff-only` on each restart, keeps a Mac awake while it runs, and
# also supervises the CI gate on the one computer with JOBLINE_AGENT_GATE=1.
set -u
cd "$(dirname "$0")/../../.." || exit 1
ROOT="$(pwd)"
STATE="$ROOT/.agent-loop"
mkdir -p "$STATE/logs"
rm -f "$STATE/STOP"
if [ -f "$STATE/host.env" ]; then set -a; . "$STATE/host.env"; set +a; fi

# Keep a Mac awake for as long as this script runs.
if [ "$(uname)" = "Darwin" ] && [ -z "${CAFFEINATED:-}" ] && command -v caffeinate >/dev/null; then
  export CAFFEINATED=1
  exec caffeinate -dims "$0" "$@"
fi

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [supervisor] $*" | tee -a "$STATE/logs/supervisor.log"; }

update() {
  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    log "no upstream branch; not pulling"
    return
  fi
  if git diff --quiet && git diff --cached --quiet; then
    before="$(git rev-parse HEAD)"
    git pull --ff-only -q 2>>"$STATE/logs/supervisor.log" || log "git pull failed; running the current code"
    if [ "$before" != "$(git rev-parse HEAD)" ]; then
      log "updated to $(git rev-parse --short HEAD)"
      if ! git diff --quiet "$before" HEAD -- package-lock.json; then log "dependencies changed; npm ci"; npm ci --no-audit --no-fund >>"$STATE/logs/supervisor.log" 2>&1; fi
    fi
  else
    log "local changes present; not pulling"
  fi
}

supervise() { # name, then the cli arguments
  local name="$1"; shift
  local wait=30
  while [ ! -f "$STATE/STOP" ]; do
    update
    log "$name starting"
    node tools/agent-loop/cli.mjs "$@" >>"$STATE/logs/$name-$(date +%Y%m%d).log" 2>&1
    code=$?
    [ -f "$STATE/STOP" ] && break
    if [ "$code" -eq 75 ]; then log "$name scheduled restart"; wait=30; continue; fi
    if [ "$code" -eq 0 ] && [ -n "${JOBLINE_AGENT_UNTIL:-}" ]; then log "$name reached its stop time"; break; fi
    log "$name exited with $code; restarting in ${wait}s"
    sleep "$wait"
    wait=$(( wait * 2 > 900 ? 900 : wait * 2 ))
  done
  log "$name stopped"
}

RUN_ARGS=(run --watch --restart-every "${JOBLINE_AGENT_RESTART_EVERY:-3h}")
[ -n "${JOBLINE_AGENT_UNTIL:-}" ] && RUN_ARGS+=(--until "$JOBLINE_AGENT_UNTIL")

node tools/agent-loop/cli.mjs doctor | tee -a "$STATE/logs/supervisor.log"
if [ "${JOBLINE_AGENT_GATE:-0}" = "1" ]; then
  supervise gate gate --watch --file-tasks &
fi
supervise run "${RUN_ARGS[@]}"
wait
