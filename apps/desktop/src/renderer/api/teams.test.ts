import { describe, expect, it } from 'vitest'
import { isTeamAgent, teamAgentString, teamIdFromAgent } from './teams.js'

describe('team agent-string helpers', () => {
  it('builds an id-qualified team agent string', () => {
    expect(teamAgentString('web-appsec')).toBe('claude-team:web-appsec')
  })

  it('parses the id back out, with the bare sentinel yielding the empty (default) id', () => {
    expect(teamIdFromAgent('claude-team')).toBe('')
    expect(teamIdFromAgent('claude-team:web-appsec')).toBe('web-appsec')
  })

  it('returns null for non-team agents', () => {
    expect(teamIdFromAgent('claude')).toBeNull()
    expect(teamIdFromAgent('codex')).toBeNull()
    expect(teamIdFromAgent('shell')).toBeNull()
  })

  it('isTeamAgent recognises both team forms and rejects others', () => {
    expect(isTeamAgent('claude-team')).toBe(true)
    expect(isTeamAgent('claude-team:code-audit')).toBe(true)
    expect(isTeamAgent('claude')).toBe(false)
  })
})
