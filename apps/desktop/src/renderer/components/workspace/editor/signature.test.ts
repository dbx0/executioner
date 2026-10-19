import { describe, expect, it } from 'vitest'
import { getDiskBaselineSignature } from './signature.js'

describe('getDiskBaselineSignature', () => {
  it('is stable for identical content', () => {
    expect(getDiskBaselineSignature('hello')).toBe(getDiskBaselineSignature('hello'))
  })

  it('differs for different content', () => {
    expect(getDiskBaselineSignature('hello')).not.toBe(getDiskBaselineSignature('hellp'))
  })

  it('differs for a transposition of the same bytes', () => {
    expect(getDiskBaselineSignature('ab')).not.toBe(getDiskBaselineSignature('ba'))
  })

  it('encodes the length, so same-hash different-length content cannot collide', () => {
    const short = getDiskBaselineSignature('a')
    const long = getDiskBaselineSignature('a'.repeat(64))
    expect(short.split('-')[2]).not.toBe(long.split('-')[2])
  })

  it('handles empty content', () => {
    expect(getDiskBaselineSignature('')).toBe(getDiskBaselineSignature(''))
  })
})
