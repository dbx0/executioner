import { describe, expect, it } from 'vitest'
import { AGENT_BINARIES, checkAgents, probeAgent } from './agents.js'

describe('AGENT_BINARIES', () => {
  it('includes claude and codex', () => {
    expect(AGENT_BINARIES.map((a) => a.id)).toEqual(
      expect.arrayContaining(['claude', 'codex']),
    )
  })
})

describe('probeAgent / checkAgents', () => {
  it('finds node on PATH', async () => {
    await expect(probeAgent('node')).resolves.toBe(true)
  })

  it('returns a row for every known agent id', async () => {
    const rows = await checkAgents()
    expect(rows.map((r) => r.id).sort()).toEqual(
      [...AGENT_BINARIES.map((a) => a.id)].sort(),
    )
    for (const row of rows) {
      expect(typeof row.installed).toBe('boolean')
    }
  })
})
