import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { contextFileForAgent, writeBriefingContextBlock } from './agent-context-file.js'

describe('contextFileForAgent', () => {
  it('maps each agent to the context file it reads from its working directory', () => {
    expect(contextFileForAgent('codex')).toBe('AGENTS.md')
    expect(contextFileForAgent('cursor')).toBe('AGENTS.md')
    expect(contextFileForAgent('hermes')).toBe('AGENTS.md')
    expect(contextFileForAgent('gemini')).toBe('GEMINI.md')
  })

  it('returns undefined for agents that take context another way (or unknown ones)', () => {
    // claude uses --append-system-prompt; opencode uses its instructions config.
    expect(contextFileForAgent('claude')).toBeUndefined()
    expect(contextFileForAgent('opencode')).toBeUndefined()
    expect(contextFileForAgent('mystery')).toBeUndefined()
  })
})

describe('writeBriefingContextBlock', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exe-ctxfile-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the file with the briefing inside its managed markers', () => {
    const path = writeBriefingContextBlock(dir, 'AGENTS.md', 'BRIEFING BODY')
    expect(path).toBe(join(dir, 'AGENTS.md'))
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('BRIEFING BODY')
    expect(text).toContain('executioner:briefing')
  })

  it('replaces only its own block, preserving user content and other managed blocks', () => {
    const path = join(dir, 'AGENTS.md')
    writeFileSync(
      path,
      '# My notes\nkeep me\n\n<!-- executioner:skills:start -->\nskills here\n<!-- executioner:skills:end -->\n',
    )
    writeBriefingContextBlock(dir, 'AGENTS.md', 'FIRST')
    writeBriefingContextBlock(dir, 'AGENTS.md', 'SECOND')
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('# My notes')
    expect(text).toContain('keep me')
    expect(text).toContain('skills here') // the skills block survived
    expect(text).toContain('SECOND')
    expect(text).not.toContain('FIRST') // our block was replaced, not appended
  })
})
