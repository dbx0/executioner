import { describe, expect, it } from 'vitest'
import { TargetKind, targetSchema, targetFactSchema, normaliseTargetValue } from './target.js'

describe('targetSchema', () => {
  it('accepts a well formed domain target', () => {
    const parsed = targetSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'domain',
      value: 'example.com',
      parentId: null,
      source: 'manual',
      firstSeen: '2026-09-01T00:00:00.000Z',
      lastSeen: '2026-09-01T00:00:00.000Z',
    })
    expect(parsed.kind).toBe(TargetKind.Domain)
  })

  it('rejects an unknown kind', () => {
    expect(() => targetSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'planet',
      value: 'example.com',
      parentId: null,
      source: 'manual',
      firstSeen: '2026-09-01T00:00:00.000Z',
      lastSeen: '2026-09-01T00:00:00.000Z',
    })).toThrow()
  })
})

describe('normaliseTargetValue', () => {
  it('lowercases and strips a trailing dot from hostnames', () => {
    expect(normaliseTargetValue('domain', 'Example.COM.')).toBe('example.com')
  })

  it('leaves ip values untouched apart from trimming', () => {
    expect(normaliseTargetValue('ip', ' 10.0.0.1 ')).toBe('10.0.0.1')
  })

  it('does not lowercase or strip a trailing dot from ip values', () => {
    // A hostname would be lowercased and lose the trailing dot; ip values must not be.
    expect(normaliseTargetValue('ip', ' 2001:DB8::1. ')).toBe('2001:DB8::1.')
  })
})

describe('targetFactSchema', () => {
  it('accepts a port fact with arbitrary data', () => {
    const fact = targetFactSchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      targetId: '11111111-1111-4111-8111-111111111111',
      kind: 'port',
      executionId: null,
      nodeId: 'nmap-1',
      collectedAt: '2026-09-01T00:00:00.000Z',
      data: { port: 443, protocol: 'tcp', service: 'https' },
    })
    expect(fact.data.port).toBe(443)
  })
})
