import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createProject, readProgramDescription, scaffoldEngagement, type Project } from '@exe/project'
import { overviewRoutes, ACTIVITY_DAYS } from './overview.js'

let root: string
let project: Project
let app: Hono

interface Overview {
  engagement: { name: string; icon: string | null; createdAt: string; description: string; defaultBackend: string }
  targets: {
    total: number
    byScope: { in: number; unknown: number; out: number }
    byKind: Record<string, number>
    coverage: { withFindings: number; reconOnly: number; untouched: number }
  }
  findings: {
    total: number
    bySeverity: Record<string, number>
    byStatus: Record<string, number>
    topTargets: { id: string; value: string; findings: number; worst: string }[]
  }
  runs: { total: number; running: number; succeeded: number; failed: number }
  scope: { rules: number; includes: number; excludes: number }
  facts: { total: number; byKind: Record<string, number> }
  automation: { workflows: number; schedules: number; savedAgents: number }
  activity: { date: string; findings: number; runs: number; targets: number }[]
}

const get = async (): Promise<Overview> => (await app.request('/project/overview')).json() as Promise<Overview>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-overview-'))
  project = createProject(root, { name: 'acme' })
  app = new Hono().route('/', overviewRoutes(project))
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

describe('GET /project/overview', () => {
  it('reports the engagement identity', async () => {
    const body = await get()
    expect(body.engagement.name).toBe('acme')
    expect(body.engagement.icon).toBeNull()
    expect(body.engagement.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(body.engagement.defaultBackend).toBe('local')
  })

  it('counts targets by scope verdict and by kind', async () => {
    project.scopeRules.add({ effect: 'include', pattern: '*.example.com', source: 'manual' })
    project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    project.targets.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'manual' })
    project.targets.upsert({ kind: 'ip', value: '10.0.0.1', source: 'manual' })

    const body = await get()
    expect(body.targets.total).toBe(3)
    expect(body.targets.byScope.in).toBe(2)
    expect(body.targets.byScope.unknown).toBe(1)
    expect(body.targets.byKind).toMatchObject({ domain: 1, subdomain: 1, ip: 1 })
  })

  it('splits findings by severity and status and ranks the worst-hit assets', async () => {
    const a = project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    const b = project.targets.upsert({ kind: 'domain', value: 'b.com', source: 'manual' })
    project.findings.create({ title: 'one', severity: 'critical', targetId: a.id })
    project.findings.create({ title: 'two', severity: 'low', targetId: a.id, status: 'fixed' })
    project.findings.create({ title: 'three', severity: 'medium', targetId: b.id })

    const body = await get()
    expect(body.findings.total).toBe(3)
    expect(body.findings.bySeverity).toMatchObject({ critical: 1, medium: 1, low: 1, high: 0, info: 0 })
    expect(body.findings.byStatus).toMatchObject({ open: 2, fixed: 1 })
    expect(body.findings.topTargets[0]).toMatchObject({ value: 'a.com', findings: 2, worst: 'critical' })
  })

  it('splits the in-scope surface into hit, recon-only and untouched', async () => {
    project.scopeRules.add({ effect: 'include', pattern: '*.example.com', source: 'manual' })
    const hit = project.targets.upsert({ kind: 'subdomain', value: 'hit.example.com', source: 'manual' })
    const recon = project.targets.upsert({ kind: 'subdomain', value: 'recon.example.com', source: 'manual' })
    project.targets.upsert({ kind: 'subdomain', value: 'quiet.example.com', source: 'manual' })
    // Out of scope assets are not part of the coverage question.
    project.targets.upsert({ kind: 'domain', value: 'elsewhere.net', source: 'manual' })
    project.findings.create({ title: 'x', severity: 'high', targetId: hit.id })
    project.facts.record({ targetId: recon.id, kind: 'port', executionId: null, nodeId: null, data: { port: 443 } })

    const body = await get()
    expect(body.targets.coverage).toEqual({ withFindings: 1, reconOnly: 1, untouched: 2 })
  })

  it('counts scope rules by effect and facts by kind', async () => {
    project.scopeRules.add({ effect: 'include', pattern: '*.example.com', source: 'manual' })
    project.scopeRules.add({ effect: 'exclude', pattern: 'shop.example.com', source: 'manual' })
    const t = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    project.facts.record({ targetId: t.id, kind: 'port', executionId: null, nodeId: null, data: { port: 80 } })
    project.facts.record({ targetId: t.id, kind: 'port', executionId: null, nodeId: null, data: { port: 443 } })
    project.facts.record({ targetId: t.id, kind: 'technology', executionId: null, nodeId: null, data: { name: 'nginx' } })

    const body = await get()
    expect(body.scope).toEqual({ rules: 2, includes: 1, excludes: 1 })
    expect(body.facts.total).toBe(3)
    expect(body.facts.byKind).toEqual({ port: 2, technology: 1 })
  })

  it('returns a full activity window ending today', async () => {
    const t = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    project.findings.create({ title: 'today', severity: 'info', targetId: t.id })

    const body = await get()
    expect(body.activity).toHaveLength(ACTIVITY_DAYS)
    const today = new Date().toISOString().slice(0, 10)
    expect(body.activity[body.activity.length - 1]?.date).toBe(today)
    expect(body.activity[body.activity.length - 1]?.findings).toBe(1)
    expect(body.activity[body.activity.length - 1]?.targets).toBe(1)
  })

  it('reads the program description out of HUNT.md', async () => {
    scaffoldEngagement(root, { name: 'acme', description: 'Test the public API surface.' })
    expect((await get()).engagement.description).toBe('Test the public API surface.')
  })

  it('treats the scaffold placeholder as no description', async () => {
    scaffoldEngagement(root, { name: 'acme' })
    expect((await get()).engagement.description).toBe('')
  })

  it('stops the description at the next heading', () => {
    writeFileSync(
      join(root, 'HUNT.md'),
      '# Hunt Log\n\n## Program\n\nLine one.\nLine two.\n\n## Toolchain\n\nnuclei\n',
      'utf8',
    )
    expect(readProgramDescription(root)).toBe('Line one.\nLine two.')
  })

  it('says nothing rather than guessing when HUNT.md is absent', () => {
    expect(readProgramDescription(join(root, 'nope'))).toBe('')
  })
})
