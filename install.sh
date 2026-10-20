#!/usr/bin/env bash
# Install the latest Executioner release on Linux or macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/dbx0/executioner/main/install.sh | bash
#
# Linux: the AppImage is extracted to ~/.local/opt/executioner (no FUSE, no
# sudo), with a launcher entry, an icon and an `executioner` command in
# ~/.local/bin. macOS: Executioner.app goes to /Applications, or to
# ~/Applications when /Applications is not writable.
#
# Environment:
#   EXECUTIONER_VERSION=v0.0.2   install that tag instead of the latest release
#
# Uninstall: curl -fsSL .../install.sh | bash -s -- --uninstall
set -euo pipefail

REPO="dbx0/executioner"
APP="Executioner"

LINUX_DIR="${HOME}/.local/opt/executioner"
LINUX_BIN="${HOME}/.local/bin/executioner"
LINUX_DESKTOP="${XDG_DATA_HOME:-${HOME}/.local/share}/applications/executioner.desktop"
LINUX_ICON="${XDG_DATA_HOME:-${HOME}/.local/share}/icons/hicolor/1024x1024/apps/executioner.png"

info() { printf '\033[1;31m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found"; }

need curl
need uname

os="$(uname -s)"
arch="$(uname -m)"

mac_app_dir() {
  if [ -w /Applications ]; then echo /Applications; else echo "${HOME}/Applications"; fi
}

uninstall() {
  case "$os" in
    Linux)
      rm -rf "$LINUX_DIR" "$LINUX_BIN" "$LINUX_DESKTOP" "$LINUX_ICON"
      command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$(dirname "$LINUX_DESKTOP")" || true
      ;;
    Darwin)
      rm -rf "/Applications/${APP}.app" "${HOME}/Applications/${APP}.app"
      ;;
    *) fail "unsupported OS: $os" ;;
  esac
  info "Executioner removed. Engagement folders and settings were left in place."
}

if [ "${1:-}" = "--uninstall" ]; then
  uninstall
  exit 0
fi

# The latest release's tag, read off the redirect GitHub serves for
# /releases/latest (no API call, so no rate limit).
resolve_tag() {
  if [ -n "${EXECUTIONER_VERSION:-}" ]; then
    echo "$EXECUTIONER_VERSION"
    return
  fi
  local url
  url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")" \
    || fail "could not reach GitHub"
  case "$url" in
    */releases/tag/*) echo "${url##*/}" ;;
    *) fail "no published release found for ${REPO}" ;;
  esac
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

tag="$(resolve_tag)"
version="${tag#v}"

case "$os/$arch" in
  Linux/x86_64 | Linux/amd64) asset="${APP}-${version}-linux-x86_64.AppImage" ;;
  Darwin/arm64) asset="${APP}-${version}-mac-arm64.zip" ;;
  Darwin/x86_64) asset="${APP}-${version}-mac-x64.zip" ;;
  *) fail "no build for $os $arch (releases ship Linux x64, macOS arm64/x64 and Windows x64)" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

base="https://github.com/${REPO}/releases/download/${tag}"
info "Downloading ${APP} ${tag} (${asset})"
curl -fL --progress-bar -o "${tmp}/${asset}" "${base}/${asset}" || fail "download failed: ${base}/${asset}"
curl -fsSL -o "${tmp}/SHA256SUMS.txt" "${base}/SHA256SUMS.txt" || fail "could not download SHA256SUMS.txt"

expected="$(awk -v f="$asset" '$2 == f || $2 == "*"f { print $1 }' "${tmp}/SHA256SUMS.txt")"
[ -n "$expected" ] || fail "${asset} is not listed in SHA256SUMS.txt"
[ "$(sha256 "${tmp}/${asset}")" = "$expected" ] || fail "checksum mismatch for ${asset}"
info "Checksum verified"

install_linux() {
  # Extracting sidesteps FUSE entirely; the AppImage's own AppRun still decides
  # whether Chromium's sandbox can run on this kernel.
  chmod +x "${tmp}/${asset}"
  (cd "$tmp" && "./${asset}" --appimage-extract >/dev/null) || fail "could not extract the AppImage"

  mkdir -p "$(dirname "$LINUX_DIR")" "$(dirname "$LINUX_BIN")" "$(dirname "$LINUX_DESKTOP")" "$(dirname "$LINUX_ICON")"
  rm -rf "${LINUX_DIR}.old"
  [ -d "$LINUX_DIR" ] && mv "$LINUX_DIR" "${LINUX_DIR}.old"
  mv "${tmp}/squashfs-root" "$LINUX_DIR"
  rm -rf "${LINUX_DIR}.old"

  ln -sf "${LINUX_DIR}/AppRun" "$LINUX_BIN"
  cp "${LINUX_DIR}/executioner.png" "$LINUX_ICON"

  cat >"$LINUX_DESKTOP" <<EOF
[Desktop Entry]
Name=${APP}
Comment=Agentic pentesting platform that lives on your machine
Exec=${LINUX_DIR}/AppRun %U
Icon=executioner
Terminal=false
Type=Application
StartupWMClass=${APP}
Categories=Development;Security;
EOF

  command -v gtk-update-icon-cache >/dev/null 2>&1 \
    && gtk-update-icon-cache -q -t "$(dirname "$(dirname "$(dirname "$(dirname "$LINUX_ICON")")")")" 2>/dev/null || true
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database -q "$(dirname "$LINUX_DESKTOP")" 2>/dev/null || true

  info "Installed to ${LINUX_DIR}"
  echo "    Open it from your app launcher, or run: executioner"
  case ":${PATH}:" in
    *":$(dirname "$LINUX_BIN"):"*) ;;
    *) echo "    Note: $(dirname "$LINUX_BIN") is not on your PATH" ;;
  esac
}

install_mac() {
  need ditto
  ditto -x -k "${tmp}/${asset}" "${tmp}/app" || fail "could not unpack ${asset}"
  local dest
  dest="$(mac_app_dir)"
  mkdir -p "$dest"
  rm -rf "${dest}/${APP}.app"
  ditto "${tmp}/app/${APP}.app" "${dest}/${APP}.app"
  # Builds without a Developer ID are only ad-hoc signed; drop the quarantine
  # flag so Gatekeeper does not refuse to open them.
  xattr -dr com.apple.quarantine "${dest}/${APP}.app" 2>/dev/null || true
  info "Installed to ${dest}/${APP}.app"
}

case "$os" in
  Linux) install_linux ;;
  Darwin) install_mac ;;
esac

info "${APP} ${tag} is ready"
