import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach } from 'vitest'

/**
 * Isolate the user-level Executioner directory for the test run. Connections,
 * secrets, skills and saved agents are global — shared by every engagement — so
 * without this a test would inherit whatever the previous one saved, and a run
 * would read and write the developer's real `~/.executioner`.
 *
 * A fresh directory per test keeps cases independent; a test that means to
 * prove two engagements share a connection opens both inside the one test.
 */
const runDir = mkdtempSync(join(tmpdir(), 'exe-home-'))
let n = 0

beforeEach(() => {
  n += 1
  const dir = join(runDir, `t${n}`)
  mkdirSync(dir, { recursive: true })
  process.env.EXECUTIONER_HOME = dir
})

afterAll(() => {
  rmSync(runDir, { recursive: true, force: true })
})
