import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './index.js'
import { FactRepository } from './facts.js'
import { TargetRepository } from './targets.js'

let facts: FactRepository
let targets: TargetRepository
let targetId: string

beforeEach(() => {
  const db = openDatabase(':memory:')
  targets = new TargetRepository(db)
  facts = new FactRepository(db)
  targetId = targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' }).id
})

describe('FactRepository', () => {
  it('de-duplicates an identical (target, kind, data) fact instead of inserting twice', () => {
    const data = { port: 443, service: 'https', protocol: 'tcp' }
    facts.record({ targetId, kind: 'port', executionId: null, nodeId: 'nmap-1', data })
    // Same port re-emitted by a save-to-target node (or a re-run): must not duplicate.
    facts.record({ targetId, kind: 'port', executionId: null, nodeId: 'save-1', data: { ...data } })
    expect(facts.forTarget(targetId).filter((f) => f.kind === 'port')).toHaveLength(1)
  })

  it('keeps the latest version of a port (same port+protocol) instead of duplicating', () => {
    facts.record({ targetId, kind: 'port', executionId: null, nodeId: 'nmap-1', data: { port: 443, protocol: 'tcp', service: 'https' } })
    facts.record({ targetId, kind: 'port', executionId: null, nodeId: 'nmap-2', data: { port: 443, protocol: 'tcp', service: 'https', version: 'nginx 1.25' } })
    const ports = facts.forTarget(targetId).filter((f) => f.kind === 'port')
    expect(ports).toHaveLength(1)
    expect(ports[0]!.data.version).toBe('nginx 1.25')
  })

  it('keeps a single whois record per target, replaced with the latest', () => {
    facts.record({ targetId, kind: 'whois', executionId: null, nodeId: 'whois-1', data: { registrar: 'GoDaddy', expires: '2025-01-01' } })
    facts.record({ targetId, kind: 'whois', executionId: null, nodeId: 'whois-2', data: { registrar: 'GoDaddy', expires: '2026-01-01' } })
    const whois = facts.forTarget(targetId).filter((f) => f.kind === 'whois')
    expect(whois).toHaveLength(1)
    expect(whois[0]!.data.expires).toBe('2026-01-01')
  })


  it('records a fact and reads it back with its data intact', () => {
    facts.record({
      targetId,
      kind: 'port',
      executionId: null,
      nodeId: 'nmap-1',
      data: { port: 443, protocol: 'tcp' },
    })
    const found = facts.forTarget(targetId, 'port')
    expect(found).toHaveLength(1)
    expect(found[0]!.data).toEqual({ port: 443, protocol: 'tcp' })
  })

  it('filters by kind', () => {
    facts.record({ targetId, kind: 'port', executionId: null, nodeId: null, data: { port: 80 } })
    facts.record({ targetId, kind: 'technology', executionId: null, nodeId: null, data: { name: 'nginx' } })
    expect(facts.forTarget(targetId, 'port')).toHaveLength(1)
    expect(facts.forTarget(targetId)).toHaveLength(2)
  })

  it('records many facts in a single transaction', () => {
    facts.recordMany([
      { targetId, kind: 'port', executionId: null, nodeId: null, data: { port: 80 } },
      { targetId, kind: 'port', executionId: null, nodeId: null, data: { port: 443 } },
    ])
    expect(facts.forTarget(targetId, 'port')).toHaveLength(2)
  })

  it('rejects a fact for a target that does not exist', () => {
    expect(() =>
      facts.record({
        targetId: '00000000-0000-4000-8000-000000000000',
        kind: 'port',
        executionId: null,
        nodeId: null,
        data: {},
      }),
    ).toThrow()
  })

  it('counts the distinct targets a given run recorded facts on', () => {
    const other = targets.upsert({ kind: 'domain', value: 'other.com', source: 'manual' }).id
    facts.record({ targetId, kind: 'port', executionId: 'run-1', nodeId: 'n', data: { port: 80, protocol: 'tcp' } })
    facts.record({ targetId, kind: 'port', executionId: 'run-1', nodeId: 'n', data: { port: 443, protocol: 'tcp' } })
    facts.record({ targetId: other, kind: 'port', executionId: 'run-2', nodeId: 'n', data: { port: 80, protocol: 'tcp' } })
    expect(facts.targetCountForExecution('run-1')).toBe(1)
    expect(facts.targetCountForExecution('nope')).toBe(0)
  })
})
