#!/usr/bin/env bash
# Stop Mac portable Executioner host and engines it started on the default port range.
set -euo pipefail

SUPPORT="${HOME}/Library/Application Support/Executioner Host"

/usr/bin/osascript -e 'tell application "Executioner Host" to quit' >/dev/null 2>&1 || true
sleep 0.4

pkill -f "Executioner Host.app/Contents/MacOS/launcher" 2>/dev/null || true
pkill -f "Executioner Host.app/Contents/Resources/launcher.sh" 2>/dev/null || true
pkill -f "cli.js serve --bind 127.0.0.1:478" 2>/dev/null || true

for p in $(/usr/sbin/lsof -nP -iTCP:47821-47830 -sTCP:LISTEN -t 2>/dev/null || true); do
  kill "${p}" 2>/dev/null || true
done

rm -f "${SUPPORT}/bind.txt" "${SUPPORT}/host.pid" "${SUPPORT}/reopen.flag" 2>/dev/null || true

if /usr/bin/curl -sf --max-time 1 http://127.0.0.1:47821/health >/dev/null 2>&1; then
  echo "warning: something still answers on 127.0.0.1:47821" >&2
  exit 1
fi

echo "Executioner Host stopped."
