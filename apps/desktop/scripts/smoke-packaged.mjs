#!/usr/bin/env node
/**
 * Smoke-test an unpacked electron-builder output: run the packaged Electron
 * binary as Node (ELECTRON_RUN_AS_NODE=1, exactly how the app spawns its
 * engine) and load the native modules from the bundled node_modules. Catches
 * an ABI mismatch or a missing/unloadable .node before a release ships.
 *
 * Usage: node scripts/smoke-packaged.mjs <unpacked dir>
 *   linux:  release/linux-unpacked
 *   mac:    release/mac-arm64 or release/mac (x64)
 *   win:    release/win-unpacked
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '')
if (!existsSync(dir)) {
  console.error(`smoke: no such directory ${dir}`)
  process.exit(2)
}

let binary
let appDir
const macApp = readdirSync(dir).find((name) => name.endsWith('.app'))
if (macApp !== undefined) {
  const contents = join(dir, macApp, 'Contents')
  binary = join(contents, 'MacOS', macApp.replace(/\.app$/, ''))
  appDir = join(contents, 'Resources', 'app')
} else if (existsSync(join(dir, 'Executioner.exe'))) {
  binary = join(dir, 'Executioner.exe')
  appDir = join(dir, 'resources', 'app')
} else {
  binary = join(dir, 'executioner')
  appDir = join(dir, 'resources', 'app')
}

const probe = `
const { createRequire } = require('node:module')
const req = createRequire(${JSON.stringify(join(appDir, 'node_modules', '@exe', 'engine', 'package.json'))})
const Database = req('better-sqlite3')
const row = new Database(':memory:').prepare('select sqlite_version() as v').get()
const pty = req('node-pty')
if (typeof pty.spawn !== 'function') throw new Error('node-pty did not load')
console.log('smoke ok: electron ' + process.versions.electron + ' abi ' + process.versions.modules + ', sqlite ' + row.v + ', node-pty loaded')
`

const result = spawnSync(binary, ['-e', probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
})
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error) throw result.error
if (result.status !== 0 || !(result.stdout ?? '').includes('smoke ok')) {
  console.error(`smoke: packaged app at ${binary} failed (exit ${String(result.status)})`)
  process.exit(1)
}
