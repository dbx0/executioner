import { describe, expect, it } from 'vitest'
import { agentAdapters, extractJsonResult } from './agents.js'

/** Narrow a record lookup to a present value, failing loudly if it is missing. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value, got undefined')
  return v
}

describe('agentAdapters', () => {
  it('builds a claude argv with the prompt', () => {
    const adapter = must(agentAdapters.claude)
    const argv = adapter.buildArgv({ prompt: 'find open ports', headless: true })
    expect(argv[0]).toBe('claude')
    expect(argv.join(' ')).toContain('find open ports')
  })

  it('exposes an adapter per supported agent', () => {
    expect(Object.keys(agentAdapters).sort()).toEqual(
      ['claude', 'codex', 'opencode', 'gemini', 'cursor', 'hermes'].sort()
    )
  })

  it('builds opencode argv (interactive, headless, resume, empty)', () => {
    const a = agentAdapters.opencode!
    expect(a.buildArgv({ prompt: 'scan', headless: false })).toEqual(['opencode', '--prompt', 'scan'])
    expect(a.buildArgv({ prompt: 'scan', headless: true })).toEqual(['opencode', 'run', 'scan'])
    expect(a.buildArgv({ prompt: '', headless: false, resume: 'sess-1' })).toEqual([
      'opencode',
      '--session',
      'sess-1',
    ])
    expect(a.buildArgv({ prompt: '', headless: false })).toEqual(['opencode'])
  })

  it('builds gemini argv (interactive, headless, resume, empty)', () => {
    const a = agentAdapters.gemini!
    expect(a.buildArgv({ prompt: 'scan', headless: false })).toEqual([
      'gemini',
      '--prompt-interactive',
      'scan',
    ])
    expect(a.buildArgv({ prompt: 'scan', headless: true })).toEqual(['gemini', '-p', 'scan'])
    expect(a.buildArgv({ prompt: '', headless: false, resume: 'g-1' })).toEqual([
      'gemini',
      '--resume',
      'g-1',
    ])
    expect(a.buildArgv({ prompt: '', headless: false })).toEqual(['gemini'])
  })

  it('builds cursor argv (interactive, headless, empty); resume is not supported', () => {
    const a = agentAdapters.cursor!
    expect(a.buildArgv({ prompt: 'scan', headless: false })).toEqual(['cursor-agent', 'scan'])
    expect(a.buildArgv({ prompt: 'scan', headless: true })).toEqual(['cursor-agent', '-p', 'scan'])
    // Cursor is not resumed: a resume id launches a fresh interactive session.
    expect(a.buildArgv({ prompt: '', headless: false, resume: 'x' })).toEqual(['cursor-agent'])
    expect(a.buildArgv({ prompt: '', headless: false })).toEqual(['cursor-agent'])
  })

  it('builds hermes argv (interactive, headless, empty); resume is not supported', () => {
    const a = agentAdapters.hermes!
    expect(a.buildArgv({ prompt: 'scan', headless: false })).toEqual([
      'hermes',
      'chat',
      '--query=scan',
      '--tui',
    ])
    expect(a.buildArgv({ prompt: 'scan', headless: true })).toEqual([
      'hermes',
      'chat',
      '--query=scan',
      '--cli',
    ])
    // Hermes is not resumed: a resume id launches a fresh interactive session.
    expect(a.buildArgv({ prompt: '', headless: false, resume: 'x' })).toEqual(['hermes', '--tui'])
    expect(a.buildArgv({ prompt: '', headless: false })).toEqual(['hermes', '--tui'])
  })

  it('resumes a claude conversation by id (--resume) with no prompt', () => {
    const argv = agentAdapters.claude!.buildArgv({ prompt: '', headless: false, resume: 'abc-123' })
    expect(argv).toEqual(['claude', '--resume', 'abc-123'])
  })

  it('resumes a codex conversation by id (resume subcommand)', () => {
    const argv = agentAdapters.codex!.buildArgv({ prompt: '', headless: false, resume: 'sess-9' })
    expect(argv).toEqual(['codex', 'resume', 'sess-9'])
  })

  it('ignores an empty resume id and launches fresh', () => {
    expect(agentAdapters.claude!.buildArgv({ prompt: '', headless: false, resume: '' })).toEqual(['claude'])
  })

  it('never resumes a headless run', () => {
    const argv = agentAdapters.claude!.buildArgv({ prompt: 'go', headless: true, resume: 'abc-123' })
    expect(argv).toEqual(['claude', '-p', 'go'])
  })
})

describe('extractJsonResult', () => {
  it('extracts a fenced json block', () => {
    const transcript = 'thinking...\n```json\n{"hosts":["a.com"],"risk":"low"}\n```\ndone\n'
    expect(extractJsonResult(transcript)).toEqual({ hosts: ['a.com'], risk: 'low' })
  })

  it('uses the last fenced json block when several are present', () => {
    const transcript = '```json\n{"draft":true}\n```\nlater\n```json\n{"final":true}\n```\n'
    expect(extractJsonResult(transcript)).toEqual({ final: true })
  })

  it('falls back to the last bare json object when no fence is present', () => {
    const transcript = 'result: {"ok":true}\n'
    expect(extractJsonResult(transcript)).toEqual({ ok: true })
  })

  it('returns undefined when no json can be found', () => {
    expect(extractJsonResult('no structured output here')).toBeUndefined()
  })

  it('returns undefined for a fenced block that is not valid json', () => {
    expect(extractJsonResult('```json\nnot json\n```')).toBeUndefined()
  })
})
