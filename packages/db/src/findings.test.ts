import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './index.js'
import { FindingRepository } from './findings.js'
import { TargetRepository } from './targets.js'

let findings: FindingRepository
let targets: TargetRepository
let targetId: string

beforeEach(() => {
  const db = openDatabase(':memory:')
  targets = new TargetRepository(db)
  findings = new FindingRepository(db)
  targetId = targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' }).id
})

describe('FindingRepository', () => {
  it('creates a finding and reads it back whole', () => {
    const f = findings.create({
      title: 'AWS key in bundle.js',
      severity: 'high',
      description: 'A live access key ships to the browser.',
      details: 'AKIA…',
      targetId,
      source: 'workflow',
      executionId: 'exec-1',
      nodeId: 'js-secrets',
    })

    const read = findings.get(f.id)
    expect(read).toMatchObject({
      title: 'AWS key in bundle.js',
      severity: 'high',
      status: 'open',
      description: 'A live access key ships to the browser.',
      details: 'AKIA…',
      targetId,
      source: 'workflow',
      executionId: 'exec-1',
      nodeId: 'js-secrets',
    })
    expect(read?.createdAt).toEqual(read?.updatedAt)
  })

  it('keeps a finding that has no target', () => {
    const f = findings.create({ title: 'Process notes', severity: 'info' })
    expect(f.targetId).toBeNull()
    expect(findings.list()).toHaveLength(1)
  })

  it('keeps the finding when its target is deleted', () => {
    findings.create({ title: 'Open admin panel', severity: 'high', targetId })
    targets.removeSubtree(targetId)

    const [kept] = findings.list()
    expect(kept?.title).toBe('Open admin panel')
    expect(kept?.targetId).toBeNull()
  })

  it('lists worst severity first, then most recently seen', () => {
    findings.create({ title: 'a', severity: 'low', targetId })
    findings.create({ title: 'b', severity: 'critical', targetId })
    findings.create({ title: 'c', severity: 'medium', targetId })

    expect(findings.list().map((f) => f.title)).toEqual(['b', 'c', 'a'])
  })

  it('filters by status, severity and target', () => {
    const other = targets.upsert({ kind: 'domain', value: 'other.com', source: 'manual' }).id
    findings.create({ title: 'a', severity: 'high', targetId })
    findings.create({ title: 'b', severity: 'low', targetId, status: 'fixed' })
    findings.create({ title: 'c', severity: 'high', targetId: other })

    // Two findings of equal severity: order between them is recency, which is
    // not what this test is about.
    expect(findings.list({ severity: 'high' }).map((f) => f.title).sort()).toEqual(['a', 'c'])
    expect(findings.list({ status: 'fixed' }).map((f) => f.title)).toEqual(['b'])
    expect(findings.forTarget(other).map((f) => f.title)).toEqual(['c'])
  })

  describe('record — the same finding, seen again', () => {
    it('creates it the first time', () => {
      const { finding, created } = findings.record({ title: 'Secret in app.js', severity: 'high', targetId })
      expect(created).toBe(true)
      expect(finding.title).toBe('Secret in app.js')
    })

    it('refreshes the existing one instead of piling up duplicates', () => {
      findings.record({ title: 'Secret in app.js', severity: 'medium', targetId, details: 'first' })
      const { finding, created } = findings.record({
        title: 'secret in APP.js',
        severity: 'high',
        targetId,
        details: 'second',
      })

      expect(created).toBe(false)
      expect(findings.list()).toHaveLength(1)
      expect(finding.severity).toBe('high')
      expect(finding.details).toBe('second')
    })

    it('never reopens a status a person has set', () => {
      const first = findings.record({ title: 'Secret in app.js', severity: 'high', targetId })
      findings.update(first.finding.id, { status: 'false_positive' })

      const { finding } = findings.record({ title: 'Secret in app.js', severity: 'high', targetId, details: 'again' })

      expect(finding.status).toBe('false_positive')
      // The evidence is still refreshed — only the triage decision is untouchable.
      expect(finding.details).toBe('again')
    })

    it('treats the same title on two targets as two findings', () => {
      const other = targets.upsert({ kind: 'domain', value: 'other.com', source: 'manual' }).id
      findings.record({ title: 'Secret in app.js', severity: 'high', targetId })
      findings.record({ title: 'Secret in app.js', severity: 'high', targetId: other })
      expect(findings.list()).toHaveLength(2)
    })

    it('matches an untargeted finding to another untargeted one', () => {
      findings.record({ title: 'Scope note', severity: 'info' })
      const { created } = findings.record({ title: 'Scope note', severity: 'info' })
      expect(created).toBe(false)
      expect(findings.list()).toHaveLength(1)
    })
  })

  describe('update', () => {
    it('applies a partial edit and moves updatedAt', () => {
      const f = findings.create({ title: 'a', severity: 'low', targetId, description: 'keep me' })
      const updated = findings.update(f.id, { title: 'b', severity: 'critical', status: 'confirmed' })

      expect(updated).toMatchObject({ title: 'b', severity: 'critical', status: 'confirmed', description: 'keep me' })
      expect(updated?.updatedAt.localeCompare(f.createdAt)).toBeGreaterThanOrEqual(0)
    })

    it('can detach a finding from its target', () => {
      const f = findings.create({ title: 'a', severity: 'low', targetId })
      expect(findings.update(f.id, { targetId: null })?.targetId).toBeNull()
    })

    it('returns undefined for an id that is not there', () => {
      expect(findings.update('ghost', { title: 'x' })).toBeUndefined()
    })
  })

  it('removes a finding', () => {
    const f = findings.create({ title: 'a', severity: 'low', targetId })
    findings.remove(f.id)
    expect(findings.list()).toHaveLength(0)
    // Removing what is already gone is not an error.
    expect(() => findings.remove(f.id)).not.toThrow()
  })

  it('counts only the findings a given run recorded', () => {
    findings.create({ title: 'a', severity: 'low', targetId, executionId: 'run-1' })
    findings.create({ title: 'b', severity: 'low', targetId, executionId: 'run-1' })
    findings.create({ title: 'c', severity: 'low', targetId, executionId: 'run-2' })
    expect(findings.countForExecution('run-1')).toBe(2)
    expect(findings.countForExecution('nope')).toBe(0)
  })
})
