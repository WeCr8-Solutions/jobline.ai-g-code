#!/usr/bin/env bash
# Ask the supervised loop to stop after its current steps.
cd "$(dirname "$0")/../../.." && mkdir -p .agent-loop && touch .agent-loop/STOP && echo "Stop requested; running tasks finish and pause."
pkill -INT -f "tools/agent-loop/cli.mjs (run|gate)" 2>/dev/null || true
