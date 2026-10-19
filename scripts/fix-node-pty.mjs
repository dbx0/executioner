#!/usr/bin/env node
/**
 * node-pty ships a prebuilt `spawn-helper` binary that pnpm can extract without
 * its execute bit, which makes the PTY layer fail at runtime with
 * `posix_spawnp failed` and no install-time error. Restore +x on every
 * spawn-helper so a clean `pnpm install` leaves `@exe/pty` working.
 *
 * Runs as the workspace root `postinstall`; it is a no-op on platforms/installs
 * where node-pty (or the file) is absent.
 */
import { globSync } from 'node:fs'
import { chmodSync } from 'node:fs'

const patterns = [
  // pnpm's isolated layout
  'node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper',
  // hoisted / npm layout fallback
  'node_modules/node-pty/prebuilds/*/spawn-helper',
]

let fixed = 0
for (const pattern of patterns) {
  let matches = []
  try {
    matches = globSync(pattern)
  } catch {
    // globSync unavailable or pattern miss: nothing to do
  }
  for (const file of matches) {
    try {
      chmodSync(file, 0o755)
      fixed += 1
    } catch {
      // ignore files we cannot touch
    }
  }
}

console.log(`fix-node-pty: ensured +x on ${fixed} spawn-helper binary(ies)`)
