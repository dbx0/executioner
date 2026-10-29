import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './index.js'
import { ScopeRuleRepository } from './scope-rules.js'
import { TargetRepository } from './targets.js'

let repo: TargetRepository
let rules: ScopeRuleRepository

beforeEach(() => {
  const db = openDatabase(':memory:')
  repo = new TargetRepository(db)
  rules = new ScopeRuleRepository(db)
})

describe('TargetRepository.upsert', () => {
  it('inserts a new target and returns it', () => {
    const t = repo.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    expect(t.value).toBe('example.com')
    expect(t.parentId).toBeNull()
    expect(repo.all()).toHaveLength(1)
  })

  it('normalises the value before storing', () => {
    const t = repo.upsert({ kind: 'domain', value: 'Example.COM.', source: 'manual' })
    expect(t.value).toBe('example.com')
  })

  it('does not duplicate on re-discovery and refreshes last_seen', () => {
    const first = repo.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const second = repo.upsert({ kind: 'domain', value: 'example.com', source: 'subfinder' })
    expect(second.id).toBe(first.id)
    expect(repo.all()).toHaveLength(1)
    expect(second.lastSeen >= first.lastSeen).toBe(true)
  })

  it('keeps the original source when a later tool rediscovers the target', () => {
    const parent = repo.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const first = repo.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'manual' })
    // The apex already existed, so the subdomain hangs off it from the start.
    expect(first.parentId).toBe(parent.id)

    const again = repo.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'subfinder' })
    expect(again.id).toBe(first.id)
    expect(again.source).toBe('manual')
  })

  it('never overwrites an existing parent with null', () => {
    const parent = repo.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    repo.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'x', parentId: parent.id })
    const again = repo.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'y' })
    expect(again.parentId).toBe(parent.id)
  })

  it('treats one value as one target however the caller labels its kind', () => {
    // The inverse of the old contract: (kind, value) used to be the identity,
    // which is how one host ended up stored as both a domain and a subdomain.
    const asDomain = repo.upsert({ kind: 'domain', value: 'api.example.com', source: 'manual' })
    const asSubdomain = repo.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'agent' })
    expect(asSubdomain.id).toBe(asDomain.id)
    expect(repo.all().filter((t) => t.value === 'api.example.com')).toHaveLength(1)
  })
})

describe('TargetRepository.update', () => {
  it('renames a target and refuses a colliding rename', () => {
    const t = repo.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    repo.upsert({ kind: 'domain', value: 'other.com', source: 'manual' })
    const updated = repo.update(t.id, { value: 'renamed.com' })
    expect(updated?.value).toBe('renamed.com')
    expect(() => repo.update(t.id, { value: 'other.com' })).toThrow()
  })
  it('returns undefined for an unknown id', () => {
    expect(repo.update('nope', { value: 'x.com' })).toBeUndefined()
  })
})

describe('TargetRepository.removeSubtree', () => {
  it('deletes a target and all its descendants', () => {
    const domain = repo.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const sub = repo.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'x', parentId: domain.id })
    repo.upsert({ kind: 'subdomain', value: 'deep.api.example.com', source: 'x', parentId: sub.id })
    repo.upsert({ kind: 'domain', value: 'keep.com', source: 'manual' })
    expect(repo.removeSubtree(domain.id)).toBe(3)
    expect(repo.all().map((t) => t.value)).toEqual(['keep.com'])
  })
  it('returns 0 for an unknown id', () => {
    expect(repo.removeSubtree('nope')).toBe(0)
  })
})

describe('TargetRepository.findByValue', () => {
  it('finds by normalised value', () => {
    repo.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    expect(repo.findByValue('domain', 'EXAMPLE.com.')).not.toBeUndefined()
  })

  it('returns undefined when absent', () => {
    expect(repo.findByValue('domain', 'nope.test')).toBeUndefined()
  })
})

describe('TargetRepository.scopeCounts', () => {
  it('scopeCounts counts each status', () => {
    repo.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    repo.upsert({ kind: 'domain', value: 'b.com', source: 'manual' })
    repo.upsert({ kind: 'domain', value: 'c.com', source: 'manual' })
    expect(repo.scopeCounts()).toEqual({ inScope: 0, outOfScope: 0, unknown: 3 })
  })

  it('scopeCounts splits in, out and unknown once rules judge the tree', () => {
    rules.add({ effect: 'include', pattern: '*.example.com', source: 'manual' })
    rules.add({ effect: 'exclude', pattern: 'shop.example.com', source: 'manual' })
    repo.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'manual' })
    repo.upsert({ kind: 'subdomain', value: 'www.example.com', source: 'manual' })
    repo.upsert({ kind: 'subdomain', value: 'shop.example.com', source: 'manual' })
    repo.upsert({ kind: 'domain', value: 'other.org', source: 'manual' })
    repo.reevaluateScope()

    const counts = repo.scopeCounts()
    const judged = Object.fromEntries(repo.all().map((t) => [t.value, t.scopeStatus]))
    const tally = (s: string): number => Object.values(judged).filter((v) => v === s).length
    expect(counts).toEqual({ inScope: tally('in'), outOfScope: tally('out'), unknown: tally('unknown') })
    expect(judged['shop.example.com']).toBe('out')
    expect(judged['other.org']).toBe('unknown')
    expect(counts.inScope).toBeGreaterThanOrEqual(2)
    expect(counts.outOfScope).toBe(1)
  })
})
