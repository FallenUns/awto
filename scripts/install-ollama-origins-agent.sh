#!/usr/bin/env bash
# Installs a per-user LaunchAgent that sets OLLAMA_ORIGINS at every login, so
# the local Ollama server always allow-lists Chrome's chrome-extension:// origin
# and Awto stops getting HTTP 403. macOS only.
#
# Usage:
#   ./scripts/install-ollama-origins-agent.sh                 # install (default origin chrome-extension://*)
#   ./scripts/install-ollama-origins-agent.sh "chrome-extension://<id>"   # install with a specific extension id
#   ./scripts/install-ollama-origins-agent.sh --uninstall     # remove the agent

set -euo pipefail

LABEL="com.awto.ollama-origins"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl unsetenv OLLAMA_ORIGINS 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL. Restart Ollama for the change to take effect."
  exit 0
fi

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer is macOS-only. On Linux/Windows, set OLLAMA_ORIGINS in your service manager." >&2
  exit 1
fi

ORIGINS="${1:-chrome-extension://*}"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>launchctl</string>
        <string>setenv</string>
        <string>OLLAMA_ORIGINS</string>
        <string>$ORIGINS</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST_EOF

# Reload idempotently, then apply to the current session so no logout is needed.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl setenv OLLAMA_ORIGINS "$ORIGINS"

echo "Installed $LABEL — OLLAMA_ORIGINS=\"$ORIGINS\" will be set at every login."
echo "Now active: $(launchctl getenv OLLAMA_ORIGINS)"
echo "Restart Ollama once so the running server inherits it (quit the menu-bar app and reopen, or re-run 'ollama serve')."
