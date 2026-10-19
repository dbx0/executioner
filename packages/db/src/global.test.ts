import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openGlobalDatabase } from './index.js'
import { SecretRepository } from './secrets.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'exe-globaldb-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const modeOf = (path: string): number => statSync(path).mode & 0o777

describe.skipIf(process.platform === 'win32')('openGlobalDatabase permissions', () => {
  it('keeps the secrets file and its directory to the owner', () => {
    const path = join(home, 'user', 'global.sqlite')
    const db = openGlobalDatabase(path)
    new SecretRepository(db).set('SHODAN_API_KEY', 'k')
    db.close()
    expect(modeOf(join(home, 'user'))).toBe(0o700)
    expect(modeOf(path)).toBe(0o600)
  })

  it('tightens a file an older build left world-readable', () => {
    const path = join(home, 'global.sqlite')
    writeFileSync(path, '')
    chmodSync(path, 0o644)
    chmodSync(home, 0o755)
    openGlobalDatabase(path).close()
    expect(modeOf(path)).toBe(0o600)
    expect(modeOf(home)).toBe(0o700)
  })
})
