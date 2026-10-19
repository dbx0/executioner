import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isEngagementRoot } from './ipc.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-iproot-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isEngagementRoot', () => {
  it('accepts an absolute path to an existing directory', () => {
    expect(isEngagementRoot(dir)).toBe(true)
  })

  it('refuses anything a photo should not be written under', () => {
    writeFileSync(join(dir, 'file'), '')
    for (const root of ['', 'relative/dir', join(dir, 'missing'), join(dir, 'file'), 42, null, { root: dir }]) {
      expect(isEngagementRoot(root)).toBe(false)
    }
  })
})
