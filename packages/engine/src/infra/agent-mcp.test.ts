import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isAgentWiringEnabled,
  normalizeAgentMcpWiring,
  readAgentMcpWiring,
  writeAgentMcpWiring,
} from './agent-mcp.js'

describe('normalizeAgentMcpWiring', () => {
  it('defaults junk to an empty enabled map and keeps only boolean entries', () => {
    expect(normalizeAgentMcpWiring(null)).toEqual({ enabled: {} })
    expect(normalizeAgentMcpWiring('nope')).toEqual({ enabled: {} })
    expect(normalizeAgentMcpWiring({ enabled: { opencode: false, codex: 'yes', gemini: true } })).toEqual({
      enabled: { opencode: false, gemini: true },
    })
  })
})

describe('isAgentWiringEnabled', () => {
  it('is on by default and only off when explicitly disabled', () => {
    expect(isAgentWiringEnabled({ enabled: {} }, 'opencode')).toBe(true)
    expect(isAgentWiringEnabled({ enabled: { opencode: true } }, 'opencode')).toBe(true)
    expect(isAgentWiringEnabled({ enabled: { opencode: false } }, 'opencode')).toBe(false)
  })
})

describe('read/write roundtrip', () => {
  const suiteHome = process.env.EXECUTIONER_HOME

  beforeEach(() => {
    process.env.EXECUTIONER_HOME = mkdtempSync(join(tmpdir(), 'exe-mcphome-'))
  })

  afterAll(() => {
    if (suiteHome === undefined) delete process.env.EXECUTIONER_HOME
    else process.env.EXECUTIONER_HOME = suiteHome
  })

  it('defaults to an empty map when nothing is saved', () => {
    expect(readAgentMcpWiring()).toEqual({ enabled: {} })
  })

  it('persists and reads back a saved wiring config', () => {
    writeAgentMcpWiring({ enabled: { opencode: false } })
    expect(readAgentMcpWiring()).toEqual({ enabled: { opencode: false } })
  })
})
