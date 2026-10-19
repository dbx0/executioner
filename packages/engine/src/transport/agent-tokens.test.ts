import { timingSafeEqual } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AgentTokenRegistry } from './agent-tokens.js'

// Wrapped (not replaced) so the comparison still runs and its calls can be counted.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) }
})

describe('AgentTokenRegistry', () => {
  it('issues distinct prefixed tokens that verify to their grant', () => {
    const registry = new AgentTokenRegistry()
    const a = registry.issue({ profile: 'workflow' })
    const b = registry.issue({ profile: 'interactive', sessionId: 'term-1' })
    expect(a.token).toMatch(/^exa_[A-Za-z0-9_-]{43}$/)
    expect(a.token).not.toBe(b.token)
    expect(registry.verify(a.token)?.profile).toBe('workflow')
    expect(registry.verify(a.token)?.tools.has('run_command')).toBe(false)
    expect(registry.verify(b.token)).toMatchObject({ profile: 'interactive', sessionId: 'term-1' })
    expect(registry.verify(b.token)?.tools.has('run_command')).toBe(true)
  })

  it('refuses an unknown, empty or unprefixed token', () => {
    const registry = new AgentTokenRegistry()
    const { token } = registry.issue({ profile: 'workflow' })
    expect(registry.verify('')).toBeUndefined()
    expect(registry.verify(token.slice(4))).toBeUndefined()
    expect(registry.verify(`${token}x`)).toBeUndefined()
  })

  it('refuses a revoked token, and revoking twice is harmless', () => {
    const registry = new AgentTokenRegistry()
    const issued = registry.issue({ profile: 'scope' })
    issued.revoke()
    issued.revoke()
    expect(registry.verify(issued.token)).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it('refuses a token once its lifetime is over', () => {
    let now = 1_000
    const registry = new AgentTokenRegistry(() => now)
    const { token } = registry.issue({ profile: 'assistant', ttlMs: 500 })
    now = 1_499
    expect(registry.verify(token)).toBeDefined()
    now = 1_500
    expect(registry.verify(token)).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it('compares against every live token without stopping at a match', () => {
    const registry = new AgentTokenRegistry()
    const first = registry.issue({ profile: 'workflow' })
    registry.issue({ profile: 'workflow' })
    registry.issue({ profile: 'workflow' })
    const compare = vi.mocked(timingSafeEqual)
    compare.mockClear()
    registry.verify(first.token)
    expect(compare).toHaveBeenCalledTimes(3)
    for (const [left, right] of compare.mock.calls) {
      expect((left as Buffer).length).toBe(32)
      expect((right as Buffer).length).toBe(32)
    }
  })
})
