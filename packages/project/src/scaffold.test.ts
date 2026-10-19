import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scaffoldEngagement } from './scaffold.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-scaffold-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('scaffoldEngagement', () => {
  it('creates the bug-bounty methodology folders', () => {
    scaffoldEngagement(dir, { name: 'acme' })
    for (const folder of ['recon', 'vuln', 'notes', 'evidence']) {
      expect(existsSync(join(dir, folder))).toBe(true)
    }
  })

  it('writes HUNT.md embedding the name and description', () => {
    scaffoldEngagement(dir, { name: 'acme', description: 'Test the public API surface.' })
    const hunt = readFileSync(join(dir, 'HUNT.md'), 'utf8')
    expect(hunt).toContain('acme')
    expect(hunt).toContain('Test the public API surface.')
  })

  it('writes the scope text into SCOPE.md when provided', () => {
    scaffoldEngagement(dir, { name: 'acme', scope: '*.example.com\napi.example.com' })
    const scope = readFileSync(join(dir, 'docs', 'SCOPE.md'), 'utf8')
    expect(scope).toContain('*.example.com')
    expect(scope).toContain('api.example.com')
  })

  it('reports the folders and files it created', () => {
    const result = scaffoldEngagement(dir, { name: 'acme', description: 'x', scope: 'y' })
    expect(result.folders).toEqual(expect.arrayContaining(['recon', 'vuln', 'notes', 'evidence']))
    expect(result.files).toEqual(expect.arrayContaining(['HUNT.md', 'docs/SCOPE.md']))
  })

  it('is idempotent and never overwrites an existing HUNT.md', () => {
    scaffoldEngagement(dir, { name: 'acme', description: 'first' })
    writeFileSync(join(dir, 'HUNT.md'), 'edited by user')
    scaffoldEngagement(dir, { name: 'acme', description: 'second' })
    expect(readFileSync(join(dir, 'HUNT.md'), 'utf8')).toBe('edited by user')
  })

  it('omits SCOPE.md when no scope is given', () => {
    const result = scaffoldEngagement(dir, { name: 'acme' })
    expect(existsSync(join(dir, 'docs', 'SCOPE.md'))).toBe(false)
    expect(result.files).not.toContain('docs/SCOPE.md')
  })
})
