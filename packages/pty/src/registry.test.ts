import { describe, expect, it } from 'vitest'
import { PtyRegistry } from './registry.js'
import type { PtySession } from './session.js'

// Every wait here is on the exit event, never on a guess at how long a loaded
// machine takes to start node.
const TEST_TIMEOUT_MS = 30_000

function exitOf(session: PtySession): Promise<number> {
  return new Promise((resolve) => session.onExit(resolve))
}

describe('PtyRegistry', () => {
  it(
    'creates and retrieves a session by id',
    async () => {
      const registry = new PtyRegistry()
      const session = registry.create('s1', {
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: process.cwd(),
      })
      expect(registry.get('s1')).toBe(session)
      const exited = exitOf(session)
      session.kill()
      await exited
    },
    TEST_TIMEOUT_MS,
  )

  it('returns undefined for an unknown id', () => {
    expect(new PtyRegistry().get('nope')).toBeUndefined()
  })

  it(
    'removes a session from the registry when it exits',
    async () => {
      const registry = new PtyRegistry()
      const session = registry.create('s2', { command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd() })
      expect(registry.get('s2')).toBe(session)
      // The registry subscribed first and listeners fire in order, so by the
      // time this one runs the entry is already gone.
      await exitOf(session)
      expect(registry.get('s2')).toBeUndefined()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'keeps a newer session when the one it replaced under the same id exits',
    async () => {
      const registry = new PtyRegistry()
      const opts = { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: process.cwd() }
      const older = registry.create('s3', opts)
      const newer = registry.create('s3', opts)
      const olderExited = exitOf(older)
      older.kill()
      await olderExited
      expect(registry.get('s3')).toBe(newer)

      const newerExited = exitOf(newer)
      newer.kill()
      await newerExited
      expect(registry.get('s3')).toBeUndefined()
    },
    TEST_TIMEOUT_MS,
  )
})
