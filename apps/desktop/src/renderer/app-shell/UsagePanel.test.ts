import { describe, expect, it } from 'vitest'
import { clampPercent, providerMaxPercent } from './UsagePanel.js'
import type { ProviderLimits } from '../api/usage-limits.js'

const base: ProviderLimits = {
  provider: 'claude',
  five_hour: null,
  weekly: null,
  fable: null,
  plan: null,
  error: null,
}

describe('clampPercent', () => {
  it('clamps to 0–100 and coerces non-finite to 0', () => {
    expect(clampPercent(30)).toBe(30)
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(140)).toBe(100)
    expect(clampPercent(Number.NaN)).toBe(0)
    // A window whose percent arrived undefined at runtime must not blow up.
    expect(clampPercent(undefined as unknown as number)).toBe(0)
  })
})

describe('providerMaxPercent', () => {
  it('returns the largest finite window percent', () => {
    expect(providerMaxPercent({ ...base, five_hour: { percent: 30, resetsAt: null }, weekly: { percent: 49, resetsAt: null } })).toBe(49)
  })

  it('ignores an absent/NaN window instead of poisoning Math.max to NaN', () => {
    // The regression: five_hour=30 with a broken weekly window used to yield NaN,
    // rendering a 0%-wide bar while the label still read 30%.
    const broken = { percent: Number.NaN, resetsAt: null }
    const got = providerMaxPercent({ ...base, five_hour: { percent: 30, resetsAt: null }, weekly: broken })
    expect(got).toBe(30)
    expect(Number.isNaN(got)).toBe(false)
  })

  it('is 0 when there are no windows', () => {
    expect(providerMaxPercent(base)).toBe(0)
  })
})
