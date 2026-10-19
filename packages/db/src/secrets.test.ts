import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './index.js'
import { SecretRepository } from './secrets.js'

let secrets: SecretRepository

beforeEach(() => {
  const db = openDatabase(':memory:')
  secrets = new SecretRepository(db)
})

describe('SecretRepository', () => {
  it('sets, gets and lists a secret', () => {
    const s = secrets.set('SHODAN_API_KEY', 'abc123')
    expect(s.value).toBe('abc123')
    expect(secrets.get('SHODAN_API_KEY')?.value).toBe('abc123')
    expect(secrets.list()).toHaveLength(1)
  })

  it('upserts an existing key rather than duplicating it', () => {
    secrets.set('K', 'v1')
    secrets.set('K', 'v2')
    expect(secrets.list()).toHaveLength(1)
    expect(secrets.get('K')?.value).toBe('v2')
  })

  it('removes a secret', () => {
    secrets.set('K', 'v')
    secrets.remove('K')
    expect(secrets.get('K')).toBeUndefined()
  })

  it('exposes a name → value map', () => {
    secrets.set('A', '1')
    secrets.set('B', '2')
    expect(secrets.map()).toEqual({ A: '1', B: '2' })
  })
})
