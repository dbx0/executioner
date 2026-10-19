import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every PTY the engine spawns must drop the launching session's Claude Code
 * markers. Relying on the app being launched with a clean environment is not
 * enough: `pnpm dev` run from inside a Claude Code terminal reintroduces them,
 * and the failure is silent — agents keep working but stop writing transcripts,
 * so their conversations cannot be restored.
 */
const SOURCES = [
  '../transport/server.ts',
  '../agents/agent-runner.ts',
  '../agents/assistant-runner.ts',
]

describe('PTY spawn environment', () => {
  it('passes unsetEnv at every spawn site', () => {
    for (const rel of SOURCES) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      const spawns = src.match(/(?:ptyRegistry|registry)\.create\(/g) ?? []
      const stripped = src.match(/unsetEnv: CLAUDE_SESSION_MARKERS/g) ?? []
      expect(spawns.length, `${rel} has spawn sites`).toBeGreaterThan(0)
      expect(stripped.length, `${rel}: every spawn strips the markers`).toBe(spawns.length)
    }
  })
})
