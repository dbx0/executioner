// electron-builder beforePack hook: make sure the native modules the engine
// loads have a binary for the platform/arch being packaged, before an hour of
// packaging produces an app whose engine cannot start.
//
// Both natives are Node-API addons, so one binary loads under any Node or
// Electron ABI and nothing is rebuilt for Electron:
// - better-sqlite3 (13+) ships prebuilds/<platform>-<arch>.node for every
//   platform the app is released on, and its loader prefers them.
// - node-pty ships prebuilds/<platform>-<arch>/ for darwin and win32; on Linux
//   it is compiled at install time into build/Release.
//
// This only reads node_modules; it never rewrites it.
const { existsSync } = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')

// builder-util's Arch enum, by value.
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

exports.default = async function beforePack(context) {
  const arch = ARCH[context.arch]
  if (arch === undefined || arch === 'universal') {
    throw new Error(`before-pack: unsupported arch ${String(context.arch)}`)
  }
  const platform = context.electronPlatformName
  const appDir = context.packager.info.appDir
  // Resolve the natives the way the packaged engine does: from @exe/engine.
  const req = createRequire(path.join(appDir, 'node_modules', '@exe', 'engine', 'package.json'))
  const moduleDir = (name) => path.dirname(req.resolve(`${name}/package.json`))

  const sqlite = path.join(moduleDir('better-sqlite3'), 'prebuilds', `${platform}-${arch}.node`)
  const ptyDir = moduleDir('node-pty')
  const ptyPrebuild = path.join(ptyDir, 'prebuilds', `${platform}-${arch}`, 'pty.node')
  // A source build is host-arch only, so it counts on Linux alone, where no
  // prebuild exists and releases are built natively per arch.
  const pty =
    platform === 'linux' && !existsSync(ptyPrebuild) ? path.join(ptyDir, 'build', 'Release', 'pty.node') : ptyPrebuild

  const missing = [sqlite, pty].filter((file) => !existsSync(file))
  if (missing.length > 0) {
    throw new Error(`before-pack: no native binary for ${platform}-${arch}:\n  ${missing.join('\n  ')}`)
  }
  console.log(`  • native modules present  platform=${platform} arch=${arch}`)
}
