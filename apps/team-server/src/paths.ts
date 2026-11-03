import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Monorepo root when running from apps/team-server/dist. */
export function repoRoot(): string {
  return join(here, '..', '..', '..')
}

/** Built engine CLI. Throws when the engine has not been built. */
export function resolveEnginePath(): string {
  const path = join(repoRoot(), 'packages', 'engine', 'dist', 'cli.js')
  if (!existsSync(path)) {
    throw new Error(`engine CLI not found at ${path}; run pnpm --filter @exe/engine build`)
  }
  return path
}

export function portablePublicDir(): string {
  return join(here, '..', 'public')
}
