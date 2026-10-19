import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { confineAbsolute, confinePath, isWithin } from './confine.js'

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-confine-'))
  outside = mkdtempSync(join(tmpdir(), 'exe-confine-out-'))
  mkdirSync(join(root, 'evidence'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('isWithin', () => {
  it('does not mistake a sibling sharing a prefix for a child', () => {
    expect(isWithin('/a/root', '/a/root/x')).toBe(true)
    expect(isWithin('/a/root', '/a/root')).toBe(true)
    expect(isWithin('/a/root', '/a/rootkit/x')).toBe(false)
  })
})

describe('confinePath', () => {
  it('resolves paths inside the root, existing or not yet', () => {
    expect(confinePath(root, 'evidence')).toEqual({ abs: join(root, 'evidence'), rel: 'evidence' })
    expect(confinePath(root, 'evidence/new/file.txt')?.rel).toBe(join('evidence', 'new', 'file.txt'))
    expect(confinePath(root, '')?.rel).toBe('')
  })

  it('refuses lexical traversal and absolute paths elsewhere', () => {
    expect(confinePath(root, '../x')).toBeNull()
    expect(confinePath(root, '/etc/passwd')).toBeNull()
  })

  it('refuses a path that leaves through a symlink, including one not created yet', () => {
    symlinkSync(outside, join(root, 'out'))
    expect(confinePath(root, 'out')).toBeNull()
    expect(confinePath(root, 'out/not-yet.txt')).toBeNull()
  })
})

describe('confineAbsolute', () => {
  it('takes an absolute path inside the root and refuses relative ones', () => {
    expect(confineAbsolute(root, join(root, 'evidence', 'a.png'))).toBe(join(root, 'evidence', 'a.png'))
    expect(confineAbsolute(root, 'evidence/a.png')).toBeNull()
    expect(confineAbsolute(root, join(outside, 'a.png'))).toBeNull()
  })
})
