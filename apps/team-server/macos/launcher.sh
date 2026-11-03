#!/bin/bash
# Executioner Host.app entrypoint: start host once, reopen UI on later launches.
# Invoked by Contents/MacOS/launcher (Mach-O stub). Lives in Contents/Resources/.
set -euo pipefail

APP_CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="${APP_CONTENTS}/Resources"
REPO="${RESOURCES}/executioner"
HOST_DIR="${REPO}/apps/team-server"
CLI="${HOST_DIR}/dist/cli.js"

LOG="${HOME}/Library/Logs/Executioner Host.log"
SUPPORT="${HOME}/Library/Application Support/Executioner Host"
TOKEN_FILE="${SUPPORT}/bootstrap.token"
BIND_FILE="${SUPPORT}/bind.txt"

DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT=47821

mkdir -p "${SUPPORT}" "$(dirname "${LOG}")"

resolve_node() {
  if [[ -n "${EXECUTIONER_NODE_BIN:-}" && -x "${EXECUTIONER_NODE_BIN}" ]]; then
    printf '%s\n' "${EXECUTIONER_NODE_BIN}"
    return
  fi
  if [[ -x "${RESOURCES}/node/bin/node" ]]; then
    printf '%s\n' "${RESOURCES}/node/bin/node"
    return
  fi
  if [[ -x "${RESOURCES}/node" ]]; then
    printf '%s\n' "${RESOURCES}/node"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  echo "Executioner Host: node not found. Install Node 24+ or set EXECUTIONER_NODE_BIN / rebuild with EXECUTIONER_NODE_BIN." >&2
  exit 1
}

NODE="$(resolve_node)"

if [[ ! -f "${CLI}" ]]; then
  echo "Executioner Host: missing ${CLI}" >&2
  exit 1
fi

ensure_token() {
  if [[ -s "${TOKEN_FILE}" ]]; then
    return
  fi
  # Stable across relaunches so a second double-click can reopen ?token=.
  "${NODE}" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" >"${TOKEN_FILE}.tmp"
  mv "${TOKEN_FILE}.tmp" "${TOKEN_FILE}"
}

portable_ui_url() {
  local bind="$1"
  local token="$2"
  "${NODE}" -e "const [b,t]=process.argv.slice(1); const i=b.lastIndexOf(':'); const h=b.slice(0,i); const p=b.slice(i+1); process.stdout.write('http://'+h+':'+p+'/?token='+encodeURIComponent(t))" "${bind}" "${token}"
}

health_ok() {
  local bind="$1"
  local host="${bind%:*}"
  local port="${bind##*:}"
  local body
  body="$(curl -sf --max-time 1 "http://${host}:${port}/health" 2>/dev/null || true)"
  [[ "${body}" == *'"ok":true'* && "${body}" == *'executioner-host'* ]]
}

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

pick_bind() {
  local port="${DEFAULT_PORT}"
  local max=$((DEFAULT_PORT + 50))
  while (( port <= max )); do
    if ! port_listening "${port}"; then
      printf '%s:%s\n' "${DEFAULT_HOST}" "${port}"
      return
    fi
    # Occupied by us: reuse.
    if health_ok "${DEFAULT_HOST}:${port}"; then
      printf '%s:%s\n' "${DEFAULT_HOST}" "${port}"
      return
    fi
    port=$((port + 1))
  done
  echo "Executioner Host: no free port in ${DEFAULT_PORT}-${max}" >&2
  exit 1
}

ensure_token
TOKEN="$(cat "${TOKEN_FILE}")"

# Idempotent reopen when host already healthy.
if [[ -s "${BIND_FILE}" ]]; then
  SAVED_BIND="$(cat "${BIND_FILE}")"
  if health_ok "${SAVED_BIND}"; then
    open "$(portable_ui_url "${SAVED_BIND}" "${TOKEN}")"
    exit 0
  fi
fi

if health_ok "${DEFAULT_HOST}:${DEFAULT_PORT}"; then
  printf '%s\n' "${DEFAULT_HOST}:${DEFAULT_PORT}" >"${BIND_FILE}"
  open "$(portable_ui_url "${DEFAULT_HOST}:${DEFAULT_PORT}" "${TOKEN}")"
  exit 0
fi

BIND="$(pick_bind)"
# If pick found an already-healthy port, just reopen.
if health_ok "${BIND}"; then
  printf '%s\n' "${BIND}" >"${BIND_FILE}"
  open "$(portable_ui_url "${BIND}" "${TOKEN}")"
  exit 0
fi

printf '%s\n' "${BIND}" >"${BIND_FILE}"

export EXECUTIONER_HOST_TOKEN="${TOKEN}"
cd "${HOST_DIR}"

{
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) starting executioner-host on ${BIND} (node=${NODE})"
} >>"${LOG}"

# Replace this process so Dock Quit delivers SIGTERM to the host.
exec >>"${LOG}" 2>&1
exec "${NODE}" "${CLI}" serve --bind "${BIND}" --token "${TOKEN}" --open
