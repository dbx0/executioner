import { describe, expect, it } from 'vitest'
import {
  agentActivity,
  coverageSlices,
  engagementAge,
  kindSlices,
  relativeSince,
  scopeSlices,
  severitySlices,
  statusSlices,
} from './summary.js'

const NOW = Date.parse('2026-09-22T12:00:00.000Z')

describe('relativeSince', () => {
  it('says never when nothing has happened', () => {
    expect(relativeSince(null, NOW)).toBe('never')
    expect(relativeSince('not a date', NOW)).toBe('never')
  })

  it('scales the unit to the distance', () => {
    expect(relativeSince('2026-09-22T11:59:50.000Z', NOW)).toBe('just now')
    expect(relativeSince('2026-09-22T11:20:00.000Z', NOW)).toBe('40m ago')
    expect(relativeSince('2026-09-22T04:00:00.000Z', NOW)).toBe('8h ago')
    expect(relativeSince('2026-09-19T12:00:00.000Z', NOW)).toBe('3d ago')
    expect(relativeSince('2026-06-22T12:00:00.000Z', NOW)).toBe('3mo ago')
  })
})

describe('engagementAge', () => {
  it('counts the first day as day 1', () => {
    expect(engagementAge('2026-09-22T08:00:00.000Z', NOW).day).toBe(1)
    expect(engagementAge('2026-09-12T08:00:00.000Z', NOW).day).toBe(11)
  })

  it('survives a config with an unparseable date', () => {
    expect(engagementAge('nonsense', NOW)).toEqual({ started: 'unknown', day: 1 })
  })
})

describe('slices', () => {
  it('keeps every severity, including the ones with nothing in them', () => {
    const slices = severitySlices({ critical: 2, low: 1 })
    expect(slices.map((s) => s.key)).toEqual(['critical', 'high', 'medium', 'low', 'info'])
    expect(slices.map((s) => s.value)).toEqual([2, 0, 0, 1, 0])
  })

  it('defaults a missing status to zero rather than dropping the row', () => {
    expect(statusSlices({ open: 3 }).map((s) => s.value)).toEqual([3, 0, 0, 0, 0])
  })

  it('orders scope and coverage from best to worst', () => {
    expect(scopeSlices({ in: 4, unknown: 2, out: 1 }).map((s) => s.key)).toEqual(['in', 'unknown', 'out'])
    expect(coverageSlices({ withFindings: 1, reconOnly: 2, untouched: 3 }).map((s) => s.value)).toEqual([1, 2, 3])
  })

  it('ranks asset kinds by count and labels them in plain words', () => {
    const slices = kindSlices({ ip: 1, subdomain: 9, domain: 2 })
    expect(slices.map((s) => s.label)).toEqual(['Subdomains', 'Domains', 'IPs'])
  })
})

describe('chart tones', () => {
  const everyTone = (): string[] =>
    [
      ...severitySlices({}),
      ...statusSlices({}),
      ...scopeSlices({ in: 1, unknown: 1, out: 1 }),
      ...coverageSlices({ withFindings: 1, reconOnly: 1, untouched: 1 }),
      ...kindSlices({ domain: 1 }),
    ].map((s) => s.tone)

  // `bg-status-error/60` and friends compile to nothing against this theme's
  // var() colours, which paints a bar with a count but no fill.
  it('never asks Tailwind for an opacity modifier it cannot compile', () => {
    for (const tone of everyTone()) expect(tone).not.toMatch(/\/\d+$/)
  })

  it('gives every slice of a chart its own colour', () => {
    for (const slices of [severitySlices({}), statusSlices({}), coverageSlices({ withFindings: 0, reconOnly: 0, untouched: 0 })]) {
      expect(new Set(slices.map((s) => s.tone)).size).toBe(slices.length)
    }
  })
})

describe('agentActivity', () => {
  it('counts working sessions and working sub-agents separately', () => {
    const activity = agentActivity(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      { a: 'working', b: 'idle' },
      { a: [{ state: 'working' }, { state: 'done' }], b: [{ state: 'working' }] },
    )
    expect(activity).toEqual({ working: 1, open: 3, subagents: 2 })
  })
})
