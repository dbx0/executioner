import { describe, expect, it } from 'vitest'
import { edgeRunStyle } from './edge-run-style.js'

describe('edgeRunStyle', () => {
  it('returns the lit style for success', () => {
    expect(edgeRunStyle('success')).toEqual({
      stroke: 'var(--status-success)',
      strokeWidth: 1.8,
      opacity: 1,
      transition: 'stroke .3s, stroke-width .3s, opacity .3s',
    })
  })

  it('returns undefined for running and missing', () => {
    expect(edgeRunStyle('running')).toBeUndefined()
    expect(edgeRunStyle(undefined)).toBeUndefined()
  })
})
