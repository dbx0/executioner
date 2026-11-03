#!/usr/bin/env bash
# Start Mac portable Executioner (no Electron).
# Prefers the Dock .app when built; otherwise runs pnpm host:mac in the foreground.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ROOT}/apps/team-server/dist/Executioner Host.app"

cd "${ROOT}"

if [[ "${1:-}" == "--cli" ]] || [[ ! -d "${APP}" ]]; then
  if [[ ! -d "${APP}" && "${1:-}" != "--cli" ]]; then
    echo "Host.app not found at ${APP}"
    echo "Starting via pnpm host:mac (Ctrl+C to stop). Build the app with: pnpm host:app"
  fi
  exec pnpm host:mac
fi

echo "Opening ${APP}"
echo "Quit Executioner Host from the Dock to shut down (closing the browser does not)."
exec /usr/bin/open "${APP}"
