import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createProject, type Project } from '@exe/project'
import { scopeRuleRoutes } from './scope-rules.js'

let root: string
let project: Project
let app: Hono

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-scoperules-'))
  project = createProject(root, { name: 'acme' })
  app = new Hono().route('/', scopeRuleRoutes(project))
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const post = async (body: unknown): Promise<Response> =>
  app.request('/scope/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('GET /scope/rules', () => {
  it('lists the engagement boundary', async () => {
    project.scopeRules.add({ effect: 'include', pattern: '*.smartfit.com.br', source: 'manual' })
    const res = await app.request('/scope/rules')
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown[]).toHaveLength(1)
  })
})

describe('POST /scope/rules', () => {
  it('returns the in and out of scope split after re-judging', async () => {
    project.targets.upsert({ kind: 'domain', value: 'smartfit.com.br', source: 'manual' })
    project.targets.upsert({ kind: 'domain', value: 'smartfit.io', source: 'manual' })
    project.targets.upsert({ kind: 'domain', value: 'other.org', source: 'manual' })
    await post({ effect: 'exclude', pattern: 'smartfit.io' })

    const res = await post({ effect: 'include', pattern: '*.smartfit.com.br' })
    const body = (await res.json()) as { rejudged: number; inScope: number; outOfScope: number }
    expect(body.inScope).toBe(1)
    expect(body.outOfScope).toBe(1)
  })

  it('adds a rule and reports how many targets changed verdict', async () => {
    project.targets.upsert({ kind: 'domain', value: 'smartfit.com.br', source: 'manual' })

    const res = await post({ effect: 'include', pattern: '*.smartfit.com.br' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { rule: { pattern: string }; rejudged: number }
    expect(body.rule.pattern).toBe('*.smartfit.com.br')
    expect(body.rejudged).toBe(1)
  })

  it('re-judges the tree so an exclusion applies to what is already there', async () => {
    const stray = project.targets.upsert({ kind: 'domain', value: 'smartfit.io', source: 'agent' })
    await post({ effect: 'exclude', pattern: 'smartfit.io', note: 'parked' })
    expect(project.targets.get(stray.id)?.scopeStatus).toBe('out')
  })

  it('rejects a rule with no pattern', async () => {
    expect((await post({ effect: 'include', pattern: '' })).status).toBe(400)
  })

  it('rejects an effect that is neither include nor exclude', async () => {
    expect((await post({ effect: 'maybe', pattern: 'x.com' })).status).toBe(400)
  })

  it('returns the existing rule rather than a duplicate', async () => {
    const first = (await (await post({ effect: 'include', pattern: 'smartfit.com' })).json()) as {
      rule: { id: string }
    }
    const again = (await (await post({ effect: 'include', pattern: 'smartfit.com' })).json()) as {
      rule: { id: string }
    }
    expect(again.rule.id).toBe(first.rule.id)
    expect(project.scopeRules.all()).toHaveLength(1)
  })
})

describe('PATCH /scope/rules/:id', () => {
  it('edits a rule and re-judges the tree', async () => {
    const rule = project.scopeRules.add({ effect: 'include', pattern: 'smartfit.com', source: 'manual' })
    const target = project.targets.upsert({ kind: 'domain', value: 'smartfit.com', source: 'manual' })
    expect(project.targets.get(target.id)?.scopeStatus).toBe('in')

    const res = await app.request(`/scope/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ effect: 'exclude', note: 'out after all' }),
    })

    expect(res.status).toBe(200)
    expect(project.targets.get(target.id)?.scopeStatus).toBe('out')
  })

  it('404s for a rule that does not exist', async () => {
    const res = await app.request('/scope/rules/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /scope/rules/:id', () => {
  it('removes a rule and re-judges the tree', async () => {
    const rule = project.scopeRules.add({ effect: 'include', pattern: 'smartfit.com', source: 'manual' })
    const target = project.targets.upsert({ kind: 'domain', value: 'smartfit.com', source: 'manual' })
    expect(project.targets.get(target.id)?.scopeStatus).toBe('in')

    const res = await app.request(`/scope/rules/${rule.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)

    // With the last rule gone the engagement has no boundary again.
    expect(project.targets.get(target.id)?.scopeStatus).toBe('unknown')
  })

  it('404s for a rule that does not exist', async () => {
    expect((await app.request('/scope/rules/nope', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('POST /scope/reevaluate', () => {
  it('re-judges every target on demand', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'smartfit.com', source: 'manual' })
    project.scopeRules.add({ effect: 'include', pattern: 'smartfit.com', source: 'manual' })
    // Added behind the repository's back, so the tree is stale on purpose.
    expect(project.targets.get(target.id)?.scopeStatus).toBe('unknown')

    const res = await app.request('/scope/reevaluate', { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await res.json()) as { rejudged: number }).toEqual({ rejudged: 1, inScope: 1, outOfScope: 0 })
    expect(project.targets.get(target.id)?.scopeStatus).toBe('in')
  })
})
