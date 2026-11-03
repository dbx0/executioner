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
PID_FILE="${SUPPORT}/host.pid"

DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT=47821

mkdir -p "${SUPPORT}" "$(dirname "${LOG}")"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >>"${LOG}"
}

notify() {
  local msg="$1"
  /usr/bin/osascript >/dev/null 2>&1 <<OSA || true
display notification "${msg}" with title "Executioner Host"
OSA
}

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
  # GUI apps often lack Homebrew on PATH.
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  notify "Node.js not found. Install Node 24+ or rebuild with EXECUTIONER_NODE_BIN."
  echo "Executioner Host: node not found. Install Node 24+ or set EXECUTIONER_NODE_BIN." >&2
  exit 1
}

NODE="$(resolve_node)"

if [[ ! -f "${CLI}" ]]; then
  notify "App bundle is incomplete (missing host CLI)."
  echo "Executioner Host: missing ${CLI}" >&2
  exit 1
fi

ensure_token() {
  if [[ -s "${TOKEN_FILE}" ]]; then
    return
  fi
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
  body="$(/usr/bin/curl -sf --max-time 1 "http://${host}:${port}/health" 2>/dev/null || true)"
  [[ "${body}" == *'"ok":true'* && "${body}" == *'executioner-host'* ]]
}

port_listening() {
  local port="$1"
  /usr/sbin/lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

open_ui() {
  local url="$1"
  local attempt
  for attempt in 1 2 3 4 5; do
    if /usr/bin/open "${url}" >>"${LOG}" 2>&1; then
      log "opened UI (attempt ${attempt})"
      return 0
    fi
    log "open UI failed (attempt ${attempt})"
    sleep 0.4
  done
  /usr/bin/osascript >>"${LOG}" 2>&1 <<OSA || true
open location "${url}"
OSA
}

pick_bind() {
  local port="${DEFAULT_PORT}"
  local max=$((DEFAULT_PORT + 50))
  while (( port <= max )); do
    if ! port_listening "${port}"; then
      printf '%s:%s\n' "${DEFAULT_HOST}" "${port}"
      return
    fi
    if health_ok "${DEFAULT_HOST}:${port}"; then
      printf '%s:%s\n' "${DEFAULT_HOST}" "${port}"
      return
    fi
    port=$((port + 1))
  done
  notify "No free port in ${DEFAULT_PORT}-${max}."
  echo "Executioner Host: no free port in ${DEFAULT_PORT}-${max}" >&2
  exit 1
}

ensure_token
TOKEN="$(cat "${TOKEN_FILE}")"

reopen_only() {
  local bind="$1"
  local url
  url="$(portable_ui_url "${bind}" "${TOKEN}")"
  open_ui "${url}"
  notify "Opened the portable UI."
  exit 0
}

# Idempotent reopen when host already healthy.
if [[ -s "${BIND_FILE}" ]]; then
  SAVED_BIND="$(cat "${BIND_FILE}")"
  if health_ok "${SAVED_BIND}"; then
    reopen_only "${SAVED_BIND}"
  fi
fi

if health_ok "${DEFAULT_HOST}:${DEFAULT_PORT}"; then
  printf '%s\n' "${DEFAULT_HOST}:${DEFAULT_PORT}" >"${BIND_FILE}"
  reopen_only "${DEFAULT_HOST}:${DEFAULT_PORT}"
fi

BIND="$(pick_bind)"
if health_ok "${BIND}"; then
  printf '%s\n' "${BIND}" >"${BIND_FILE}"
  reopen_only "${BIND}"
fi

# Port held by something that is not healthy yet — wait briefly, then reopen or bail.
bind_port="${BIND##*:}"
if port_listening "${bind_port}"; then
  for _ in $(seq 1 20); do
    if health_ok "${BIND}"; then
      printf '%s\n' "${BIND}" >"${BIND_FILE}"
      reopen_only "${BIND}"
    fi
    sleep 0.15
  done
  notify "Port ${bind_port} is busy. See ~/Library/Logs/Executioner Host.log"
  log "port ${bind_port} busy without healthy host; refusing second start"
  exit 1
fi

printf '%s\n' "${BIND}" >"${BIND_FILE}"
export EXECUTIONER_HOST_TOKEN="${TOKEN}"

log "starting executioner-host on ${BIND} (node=${NODE})"
notify "Starting Executioner Host..."

# Keep this process as the Dock app. Do not exec-replace with node.
(
  cd "${HOST_DIR}"
  exec "${NODE}" "${CLI}" serve --bind "${BIND}" --token "${TOKEN}"
) >>"${LOG}" 2>&1 &
HOST_PID=$!
echo "${HOST_PID}" >"${PID_FILE}"

for _ in $(seq 1 50); do
  if health_ok "${BIND}"; then
    break
  fi
  if ! kill -0 "${HOST_PID}" 2>/dev/null; then
    notify "Host exited during startup. See ~/Library/Logs/Executioner Host.log"
    log "host pid ${HOST_PID} exited before health"
    exit 1
  fi
  sleep 0.15
done

if ! health_ok "${BIND}"; then
  notify "Host did not become healthy. See ~/Library/Logs/Executioner Host.log"
  log "health timeout for ${BIND}"
  exit 1
fi

URL="$(portable_ui_url "${BIND}" "${TOKEN}")"
open_ui "${URL}"
notify "Executioner Host is ready."

REOPEN_FLAG="${SUPPORT}/reopen.flag"
rm -f "${REOPEN_FLAG}"

# Stay alive so Quit from Dock stops the host. Stub signals reopen via flag file.
trap 'kill "${HOST_PID}" 2>/dev/null || true; wait "${HOST_PID}" 2>/dev/null || true; exit 0' TERM INT HUP
while kill -0 "${HOST_PID}" 2>/dev/null; do
  if [[ -f "${REOPEN_FLAG}" ]]; then
    rm -f "${REOPEN_FLAG}"
    open_ui "$(portable_ui_url "${BIND}" "${TOKEN}")"
    notify "Opened the portable UI."
  fi
  sleep 0.25
done
wait "${HOST_PID}" 2>/dev/null || true
exit 0
