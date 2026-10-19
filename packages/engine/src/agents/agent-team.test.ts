import { describe, expect, it } from 'vitest'
import {
  type AgentDefinition,
  BUILTIN_TEAMS,
  DEFAULT_TEAM_ID,
  buildAgentsPayload,
  buildAgentsPayloadFromMembers,
  getTeam,
  isTeamAgent,
  teamBaseOf,
  memberLabel,
  resolveTeam,
  summariseTeam,
  CLAUDE_TEAM,
} from './agent-team.js'

describe('team definitions', () => {
  it('every built-in team has a unique id and a non-empty roster', () => {
    const ids = BUILTIN_TEAMS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const team of BUILTIN_TEAMS) {
      expect(team.members.length).toBeGreaterThan(0)
      // Member names are unique within a team (they become --agents map keys).
      const names = team.members.map((m) => m.name)
      expect(new Set(names).size).toBe(names.length)
      for (const m of team.members) {
        expect(m.name).toMatch(/^[a-z][a-z0-9-]*$/)
        expect(m.description.length).toBeGreaterThan(0)
        expect(m.prompt.length).toBeGreaterThan(0)
      }
    }
  })

  it('exposes the default team', () => {
    expect(getTeam(DEFAULT_TEAM_ID)).toBeDefined()
  })
})

describe('buildAgentsPayload — the claude --agents shape', () => {
  it('maps each member to a { description, prompt } entry keyed by name', () => {
    const team = getTeam('recon-strike')!
    const payload = buildAgentsPayload(team)
    expect(Object.keys(payload).sort()).toEqual(['exploit', 'recon', 'reporter', 'scanner'])
    expect(payload.recon).toEqual({
      description: expect.stringContaining('Reconnaissance'),
      prompt: expect.stringContaining('reconnaissance specialist'),
    })
  })

  it('omits tools/model when a member inherits them, and serialises tools as an array', () => {
    const payload = buildAgentsPayload(getTeam('recon-strike')!)
    // recon inherits everything → no optional keys (exactOptionalPropertyTypes).
    expect('tools' in payload.recon!).toBe(false)
    expect('model' in payload.recon!).toBe(false)
    // reporter pins tools + model.
    expect(payload.reporter!.tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Write',
      'mcp__project__list_findings',
      'mcp__project__update_finding',
      'mcp__project__list_targets',
      'mcp__project__get_target',
    ])
    expect(payload.reporter!.model).toBe('sonnet')
    // exploit pins only a model.
    expect(payload.exploit!.model).toBe('opus')
    expect('tools' in payload.exploit!).toBe(false)
  })

  it('builds the payload from a user-defined roster, skipping blank names and inherited pins', () => {
    const payload = buildAgentsPayloadFromMembers([
      { name: 'recon', description: 'enumerate', prompt: 'do recon' },
      { name: 'reporter', description: 'report', prompt: 'write up', tools: ['Read', 'Write'], model: 'haiku' },
      { name: '', description: 'skip', prompt: 'skip' },
      { name: 'lead', description: 'lead', prompt: 'lead', model: 'inherit' },
    ])
    expect(Object.keys(payload).sort()).toEqual(['lead', 'recon', 'reporter'])
    expect('tools' in payload.recon!).toBe(false)
    expect('model' in payload.recon!).toBe(false)
    expect(payload.reporter!.tools).toEqual(['Read', 'Write'])
    expect(payload.reporter!.model).toBe('haiku')
    // 'inherit' is treated as no pin.
    expect('model' in payload.lead!).toBe(false)
  })

  it('produces JSON-serialisable output (the exact thing passed to --agents)', () => {
    const json = JSON.stringify(buildAgentsPayload(getTeam('web-appsec')!))
    const round = JSON.parse(json) as Record<string, AgentDefinition>
    expect(round.injection!.model).toBe('opus')
  })
})

describe('resolveTeam / isTeamAgent — the agent-string channel', () => {
  it('treats the bare sentinel and the id-qualified form as team launches', () => {
    expect(isTeamAgent('claude-team')).toBe(true)
    expect(isTeamAgent('claude-team:web-appsec')).toBe(true)
    expect(isTeamAgent('claude')).toBe(false)
    expect(isTeamAgent('codex')).toBe(false)
    expect(isTeamAgent(undefined)).toBe(false)
  })

  it('recognises opencode teams and reports the base CLI of a team string', () => {
    expect(isTeamAgent('opencode-team')).toBe(true)
    expect(isTeamAgent('opencode-team:abc123')).toBe(true)
    expect(isTeamAgent('opencode')).toBe(false)
    // A base that has no team support isn't a team string.
    expect(isTeamAgent('gemini-team')).toBe(false)
    expect(teamBaseOf('claude-team:x')).toBe('claude')
    expect(teamBaseOf('opencode-team:x')).toBe('opencode')
  })

  it('resolves a bare sentinel to the default team', () => {
    expect(resolveTeam('claude-team').id).toBe(DEFAULT_TEAM_ID)
  })

  it('resolves an id-qualified string to that team', () => {
    expect(resolveTeam('claude-team:web-appsec').id).toBe('web-appsec')
    expect(resolveTeam('claude-team:code-audit').id).toBe('code-audit')
  })

  it('falls back to the default team for an unknown id rather than throwing', () => {
    expect(resolveTeam('claude-team:does-not-exist').id).toBe(DEFAULT_TEAM_ID)
  })
})

describe('summariseTeam / memberLabel — the prompt-free UI view', () => {
  it('drops prompts and normalises optional model/tools', () => {
    const summary = summariseTeam(getTeam('recon-strike')!)
    expect(summary).not.toHaveProperty('members.0.prompt')
    const recon = summary.members.find((m) => m.name === 'recon')!
    expect(recon).not.toHaveProperty('prompt')
    expect(recon.model).toBe('inherit')
    expect(recon.tools).toBeNull()
    const reporter = summary.members.find((m) => m.name === 'reporter')!
    expect(reporter.model).toBe('sonnet')
    expect(reporter.tools).toContain('mcp__project__list_findings')
  })

  it('labels a member from its explicit label or a title-cased name', () => {
    expect(memberLabel({ name: 'recon', description: 'x', prompt: 'y' })).toBe('Recon')
    expect(memberLabel({ name: 'recon', label: 'Recon Ops', description: 'x', prompt: 'y' })).toBe('Recon Ops')
  })
})

describe('CLAUDE_TEAM legacy export', () => {
  it('equals the default team payload for backward compatibility', () => {
    expect(CLAUDE_TEAM).toEqual(buildAgentsPayload(getTeam(DEFAULT_TEAM_ID)!))
  })
})
