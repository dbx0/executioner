import { describe, expect, it } from 'vitest'
import { BUILTIN_AGENTS } from './builtin-agents.js'
import { ENGAGEMENT_RULES, IMPACT_GATE } from './agent-team.js'

describe('BUILTIN_AGENTS', () => {
  it('ships the specialists with unique ids and names', () => {
    expect(BUILTIN_AGENTS.map((a) => a.id)).toEqual([
      'recon-scout',
      'web-hunter',
      'api-hunter',
      'mobile-recon',
      'redteam-operator',
      'detection-tester',
    ])
    expect(new Set(BUILTIN_AGENTS.map((a) => a.id)).size).toBe(BUILTIN_AGENTS.length)
    expect(new Set(BUILTIN_AGENTS.map((a) => a.name)).size).toBe(BUILTIN_AGENTS.length)
  })

  it('are single Claude agents with a prompt and a description', () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.agent).toBe('claude')
      expect(a.prompt.trim().length).toBeGreaterThan(200)
      expect(a.description.trim()).not.toBe('')
    }
  })

  it('carry the shared house rules, and the exploit specialists carry the impact gate', () => {
    for (const a of BUILTIN_AGENTS) expect(a.prompt).toContain(ENGAGEMENT_RULES)
    // `claimsImpact` is the single source of truth: the prompt is assembled from
    // it, so the gate text is present in a prompt exactly when the flag is set
    // and the two can never drift. The mappers/validators (recon-scout maps the
    // surface, detection-tester reports coverage) leave it false; the
    // specialists that claim a crossed boundary set it.
    for (const a of BUILTIN_AGENTS) expect(a.prompt.includes(IMPACT_GATE)).toBe(a.claimsImpact)
    expect(BUILTIN_AGENTS.filter((a) => a.claimsImpact).map((a) => a.id)).toEqual([
      'web-hunter',
      'api-hunter',
      'mobile-recon',
      'redteam-operator',
    ])
  })
})
