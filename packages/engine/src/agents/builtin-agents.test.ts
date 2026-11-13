import { describe, expect, it } from 'vitest'
import { BUILTIN_AGENTS } from './builtin-agents.js'
import { ENGAGEMENT_RULES, IMPACT_GATE } from './agent-team.js'

describe('BUILTIN_AGENTS', () => {
  it('ships the four specialists with unique ids and names', () => {
    expect(BUILTIN_AGENTS.map((a) => a.id)).toEqual(['recon-scout', 'web-hunter', 'api-hunter', 'mobile-recon'])
    expect(new Set(BUILTIN_AGENTS.map((a) => a.id)).size).toBe(4)
    expect(new Set(BUILTIN_AGENTS.map((a) => a.name)).size).toBe(4)
  })

  it('are single Claude agents with a prompt and a description', () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.agent).toBe('claude')
      expect(a.prompt.trim().length).toBeGreaterThan(200)
      expect(a.description.trim()).not.toBe('')
    }
  })

  it('carry the shared house rules, and the hunters carry the impact gate', () => {
    for (const a of BUILTIN_AGENTS) expect(a.prompt).toContain(ENGAGEMENT_RULES)
    // Recon maps and does not claim exploit findings, so it omits the gate; the
    // three hunters all carry it.
    expect(BUILTIN_AGENTS.filter((a) => a.prompt.includes(IMPACT_GATE)).map((a) => a.id)).toEqual([
      'web-hunter',
      'api-hunter',
      'mobile-recon',
    ])
  })
})
