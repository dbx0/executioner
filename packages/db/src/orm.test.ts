import { describe, expect, it } from 'vitest'
import { atomically, openDatabase } from './index.js'
import { TargetRepository } from './targets.js'

describe('atomically', () => {
  it('returns what the function returns', () => {
    const db = openDatabase(':memory:')
    expect(atomically(db, () => 42)).toBe(42)
  })

  it('rolls back every write when the function throws', () => {
    const db = openDatabase(':memory:')
    const targets = new TargetRepository(db)
    expect(() =>
      atomically(db, () => {
        targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
        throw new Error('disk full')
      }),
    ).toThrow('disk full')
    expect(targets.all()).toEqual([])
  })
})
