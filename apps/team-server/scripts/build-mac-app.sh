#!/usr/bin/env bash
# Build dist/Executioner Host.app with staged monorepo layout under Resources/executioner.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PKG_DIR}/../.." && pwd)"
MACOS_DIR="${PKG_DIR}/macos"
APP_NAME="Executioner Host.app"
OUT_APP="${PKG_DIR}/dist/${APP_NAME}"
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/executioner-mac-app.XXXXXX")"
cleanup() { rm -rf "${STAGE_ROOT}"; }
trap cleanup EXIT

echo "Building workspace packages required by the host…"
cd "${REPO_ROOT}"
pnpm --filter @exe/engine build
pnpm --filter @exe/team-server build

HOST_DEPLOY="${STAGE_ROOT}/host-deploy"
ENGINE_DEPLOY="${STAGE_ROOT}/engine-deploy"
rm -rf "${HOST_DEPLOY}" "${ENGINE_DEPLOY}"

echo "Deploying production trees…"
pnpm --filter @exe/team-server deploy --prod "${HOST_DEPLOY}"
pnpm --filter @exe/engine deploy --prod "${ENGINE_DEPLOY}"

STAGE_REPO="${STAGE_ROOT}/executioner"
mkdir -p "${STAGE_REPO}/apps/team-server" "${STAGE_REPO}/packages/engine"

# Keep the relative layout paths.ts expects (repoRoot → packages/engine, public beside dist).
rsync -a \
  --exclude src \
  --exclude '*.tsbuildinfo' \
  --exclude vitest.config.ts \
  --exclude tsconfig.json \
  --exclude '**/*.test.js' \
  --exclude '**/*.test.d.ts' \
  --exclude '**/*.test.js.map' \
  "${HOST_DEPLOY}/" "${STAGE_REPO}/apps/team-server/"

rsync -a \
  --exclude src \
  --exclude '*.tsbuildinfo' \
  --exclude vitest.config.ts \
  --exclude tsconfig.json \
  --exclude '**/*.test.js' \
  --exclude '**/*.test.d.ts' \
  --exclude '**/*.test.js.map' \
  "${ENGINE_DEPLOY}/" "${STAGE_REPO}/packages/engine/"

rm -rf "${OUT_APP}"
mkdir -p "${OUT_APP}/Contents/MacOS" "${OUT_APP}/Contents/Resources"

cp "${MACOS_DIR}/Info.plist" "${OUT_APP}/Contents/Info.plist"
install -m 0755 "${MACOS_DIR}/launcher.sh" "${OUT_APP}/Contents/Resources/launcher.sh"
# Launch Services requires a Mach-O CFBundleExecutable; the stub execs launcher.sh.
clang -Os -arch arm64 -arch x86_64 \
  -framework Cocoa \
  -o "${OUT_APP}/Contents/MacOS/launcher" \
  "${MACOS_DIR}/launcher-stub.m"
chmod 0755 "${OUT_APP}/Contents/MacOS/launcher"
mv "${STAGE_REPO}" "${OUT_APP}/Contents/Resources/executioner"

if [[ -n "${EXECUTIONER_NODE_BIN:-}" ]]; then
  if [[ ! -x "${EXECUTIONER_NODE_BIN}" ]]; then
    echo "EXECUTIONER_NODE_BIN is set but not executable: ${EXECUTIONER_NODE_BIN}" >&2
    exit 1
  fi
  echo "Bundling Node from EXECUTIONER_NODE_BIN=${EXECUTIONER_NODE_BIN}"
  mkdir -p "${OUT_APP}/Contents/Resources/node/bin"
  cp "${EXECUTIONER_NODE_BIN}" "${OUT_APP}/Contents/Resources/node/bin/node"
  chmod 0755 "${OUT_APP}/Contents/Resources/node/bin/node"
fi

echo "Built ${OUT_APP}"
echo "Run: open \"${OUT_APP}\""
