import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeConfigDir, transcriptPathFrom } from './agent-hooks.js'

let config: string
let outside: string

beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'exe-claude-'))
  outside = mkdtempSync(join(tmpdir(), 'exe-outside-'))
  mkdirSync(join(config, 'projects', 'p'), { recursive: true })
  writeFileSync(join(config, 'projects', 'p', 's.jsonl'), '')
  writeFileSync(join(outside, 'loot.jsonl'), '')
})

afterEach(() => {
  rmSync(config, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('transcriptPathFrom', () => {
  it('accepts a transcript inside the Claude config directory', () => {
    const path = join(config, 'projects', 'p', 's.jsonl')
    expect(transcriptPathFrom({ transcript_path: path }, config)).toBe(path)
  })

  it('refuses a path outside it, a traversal, a link out, and a non-transcript file', () => {
    symlinkSync(outside, join(config, 'projects', 'link'))
    for (const path of [
      join(outside, 'loot.jsonl'),
      join(config, '..', outside.split('/').pop() ?? '', 'loot.jsonl'),
      join(config, 'projects', 'link', 'loot.jsonl'),
      join(config, '.credentials.json'),
      'projects/p/s.jsonl',
    ]) {
      expect(transcriptPathFrom({ transcript_path: path }, config)).toBeUndefined()
    }
  })

  it('ignores a payload that names no transcript', () => {
    expect(transcriptPathFrom(undefined, config)).toBeUndefined()
    expect(transcriptPathFrom({ transcript_path: 42 }, config)).toBeUndefined()
  })
})

describe('claudeConfigDir', () => {
  it('honours CLAUDE_CONFIG_DIR and falls back to ~/.claude', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/x/claude' })).toBe('/x/claude')
    expect(claudeConfigDir({})).toMatch(/\.claude$/)
  })
})
