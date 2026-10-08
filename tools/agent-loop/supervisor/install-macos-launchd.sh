#!/usr/bin/env bash
# Start the supervised loop at login on this Mac, and restart it if it dies.
#   tools/agent-loop/supervisor/install-macos-launchd.sh
# Remove: launchctl bootout gui/$(id -u)/com.jobline.agent-loop.<repo>
set -eu
cd "$(dirname "$0")/../../.."
ROOT="$(pwd)"
REPO="$(basename "$ROOT")"
LABEL="com.jobline.agent-loop.$REPO"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.agent-loop/logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/tools/agent-loop/supervisor/start.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$(command -v node)"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$ROOT/.agent-loop/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.agent-loop/logs/launchd.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL; it is running now and starts at login."
