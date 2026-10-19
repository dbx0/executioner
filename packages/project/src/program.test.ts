import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scaffoldEngagement } from './scaffold.js'
import { readProgramDescription, writeProgramDescription } from './program.js'

let root: string
const hunt = (): string => readFileSync(join(root, 'HUNT.md'), 'utf8')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-program-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readProgramDescription', () => {
  it('reads what the scaffold wrote', () => {
    scaffoldEngagement(root, { name: 'acme', description: 'Test the public API surface.' })
    expect(readProgramDescription(root)).toBe('Test the public API surface.')
  })

  it('treats the scaffold placeholder as nothing', () => {
    scaffoldEngagement(root, { name: 'acme' })
    expect(readProgramDescription(root)).toBe('')
  })

  it('stops at the next heading', () => {
    writeFileSync(join(root, 'HUNT.md'), '# Log\n\n## Program\n\nOne.\nTwo.\n\n## Toolchain\n\nnuclei\n', 'utf8')
    expect(readProgramDescription(root)).toBe('One.\nTwo.')
  })

  it('says nothing when there is no file or no section', () => {
    expect(readProgramDescription(root)).toBe('')
    writeFileSync(join(root, 'HUNT.md'), '# Log\n\n## Findings\n', 'utf8')
    expect(readProgramDescription(root)).toBe('')
  })
})

describe('writeProgramDescription', () => {
  it('replaces the body and leaves the rest of the file alone', () => {
    scaffoldEngagement(root, { name: 'acme', description: 'raw notes, unformatted' })
    writeProgramDescription(root, '## What this is\n\n- A bug bounty\n- Web only')

    const text = hunt()
    // The brief's own heading is demoted so it cannot close the section.
    expect(readProgramDescription(root)).toBe('### What this is\n\n- A bug bounty\n- Web only')
    expect(text).toContain('# Hunt Log — acme')
    expect(text).toContain('## Phase 1: Recon')
    expect(text).toContain('## Findings')
    expect(text).not.toContain('raw notes, unformatted')
  })

  it('keeps an operator’s later sections intact when rewritten twice', () => {
    scaffoldEngagement(root, { name: 'acme', description: 'first' })
    writeProgramDescription(root, 'second')
    writeProgramDescription(root, 'third')
    expect(readProgramDescription(root)).toBe('third')
    expect(hunt()).toContain('## Toolchain')
  })

  it('survives a brief that carries its own headings', () => {
    scaffoldEngagement(root, { name: 'acme', description: 'raw' })
    writeProgramDescription(root, '# Program\n\nintro\n\n## Rules\n\n- no DoS')
    expect(readProgramDescription(root)).toBe('### Program\n\nintro\n\n### Rules\n\n- no DoS')
    expect(hunt()).toContain('## Toolchain')

    // And a second write still replaces the whole thing.
    writeProgramDescription(root, 'plain')
    expect(readProgramDescription(root)).toBe('plain')
    expect(hunt()).not.toContain('no DoS')
  })

  it('leaves a shell comment inside fenced code alone', () => {
    writeProgramDescription(root, 'brief\n\n```sh\n# not a heading\n```')
    expect(readProgramDescription(root)).toContain('# not a heading')
  })

  it('adds the section to a HUNT.md that has none', () => {
    writeFileSync(join(root, 'HUNT.md'), '# Log\n\n## Findings\n\nnothing yet\n', 'utf8')
    writeProgramDescription(root, 'the brief')
    expect(readProgramDescription(root)).toBe('the brief')
    expect(hunt()).toContain('nothing yet')
  })

  it('creates the file when the engagement has no HUNT.md', () => {
    writeProgramDescription(root, 'the brief')
    expect(readProgramDescription(root)).toBe('the brief')
  })
})
