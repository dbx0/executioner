import { describe, expect, it } from 'vitest'
import { runSummaryMessage } from './run-summary.js'

describe('runSummaryMessage', () => {
  it('reports a failed run without counts', () => {
    expect(runSummaryMessage('failed', { findings: 3, targets: 41 })).toBe('Run failed. See the nodes for details.')
  })

  it('pluralises the counts', () => {
    expect(runSummaryMessage('succeeded', { findings: 3, targets: 41 })).toBe(
      'Run finished · 3 findings saved · 41 targets updated',
    )
  })

  it('uses the singular for one', () => {
    expect(runSummaryMessage('succeeded', { findings: 1, targets: 1 })).toBe(
      'Run finished · 1 finding saved · 1 target updated',
    )
  })

  it('spells out zero', () => {
    expect(runSummaryMessage('succeeded', { findings: 0, targets: 0 })).toBe(
      'Run finished · 0 findings saved · 0 targets updated',
    )
  })

  it('falls back to a bare message when the summary could not be fetched', () => {
    expect(runSummaryMessage(undefined, null)).toBe('Run finished')
  })
})
