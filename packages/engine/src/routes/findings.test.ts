import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>
let targetId: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-findingroutes-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
  targetId = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' }).id
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { headers: { authorization: `Bearer ${TOKEN}` } }
const send = async (path: string, method: string, body?: unknown): Promise<Response> =>
  app.request(path, {
    method,
    headers: { ...auth.headers, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

interface WireFinding {
  id: string
  title: string
  severity: string
  status: string
  description: string
  details: string
  targetId: string | null
  source: string
}

describe('finding routes', () => {
  it('guards behind the bearer token', async () => {
    expect((await app.request('/api/findings')).status).toBe(401)
  })

  it('creates a finding and lists it', async () => {
    const res = await send('/api/findings', 'POST', {
      title: 'AWS key in bundle.js',
      severity: 'high',
      description: 'A live key ships to the browser.',
      details: 'AKIA…',
      targetId,
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as WireFinding
    expect(created).toMatchObject({ status: 'open', source: 'manual', targetId })

    const listed = (await (await app.request('/api/findings', auth)).json()) as WireFinding[]
    expect(listed.map((f) => f.title)).toEqual(['AWS key in bundle.js'])
  })

  it('accepts a finding with no target', async () => {
    const res = await send('/api/findings', 'POST', { title: 'Scope note', severity: 'info' })
    expect(res.status).toBe(201)
    expect(((await res.json()) as WireFinding).targetId).toBeNull()
  })

  it('rejects a bad severity or an empty title', async () => {
    expect((await send('/api/findings', 'POST', { title: 'x', severity: 'spicy' })).status).toBe(400)
    expect((await send('/api/findings', 'POST', { title: '', severity: 'high' })).status).toBe(400)
  })

  it('returns one finding, and 404s for an id that is not there', async () => {
    const created = (await (await send('/api/findings', 'POST', { title: 'a', severity: 'low' })).json()) as WireFinding

    const found = await app.request(`/api/findings/${created.id}`, auth)
    expect(((await found.json()) as WireFinding).title).toBe('a')
    expect((await app.request('/api/findings/ghost', auth)).status).toBe(404)
  })

  it('lists worst first and filters by status', async () => {
    await send('/api/findings', 'POST', { title: 'low one', severity: 'low' })
    await send('/api/findings', 'POST', { title: 'bad one', severity: 'critical' })
    const fixed = (await (
      await send('/api/findings', 'POST', { title: 'old one', severity: 'high' })
    ).json()) as WireFinding
    await send(`/api/findings/${fixed.id}`, 'PATCH', { status: 'fixed' })

    const all = (await (await app.request('/api/findings', auth)).json()) as WireFinding[]
    expect(all.map((f) => f.title)).toEqual(['bad one', 'old one', 'low one'])

    const open = (await (await app.request('/api/findings?status=open', auth)).json()) as WireFinding[]
    expect(open.map((f) => f.title)).toEqual(['bad one', 'low one'])
  })

  it('patches only the fields it names', async () => {
    const created = (await (
      await send('/api/findings', 'POST', { title: 'a', severity: 'low', description: 'keep me' })
    ).json()) as WireFinding

    const res = await send(`/api/findings/${created.id}`, 'PATCH', { severity: 'critical', status: 'confirmed' })
    expect(res.status).toBe(200)
    expect((await res.json()) as WireFinding).toMatchObject({
      title: 'a',
      severity: 'critical',
      status: 'confirmed',
      description: 'keep me',
    })
  })

  it('rejects an unknown status and 404s an unknown id', async () => {
    const created = (await (await send('/api/findings', 'POST', { title: 'a', severity: 'low' })).json()) as WireFinding
    expect((await send(`/api/findings/${created.id}`, 'PATCH', { status: 'maybe' })).status).toBe(400)
    expect((await send('/api/findings/ghost', 'PATCH', { status: 'fixed' })).status).toBe(404)
  })

  it('deletes a finding, and 404s the second time', async () => {
    const created = (await (await send('/api/findings', 'POST', { title: 'a', severity: 'low' })).json()) as WireFinding

    expect((await send(`/api/findings/${created.id}`, 'DELETE')).status).toBe(200)
    expect(((await (await app.request('/api/findings', auth)).json()) as WireFinding[]).length).toBe(0)
    expect((await send(`/api/findings/${created.id}`, 'DELETE')).status).toBe(404)
  })

  describe('the exported report', () => {
    it('writes the findings to a Markdown file under the engagement', async () => {
      await send('/api/findings', 'POST', {
        title: 'AWS key in bundle.js',
        severity: 'critical',
        description: 'A live key ships to the browser.',
        details: 'AKIAEXAMPLE',
        targetId,
      })
      await send('/api/findings', 'POST', { title: 'Directory listing', severity: 'low' })

      const res = await send('/api/findings/report', 'POST')
      expect(res.status).toBe(200)
      const written = (await res.json()) as { path: string; relativePath: string; count: number }
      expect(written.count).toBe(2)
      expect(written.relativePath).toMatch(/^reports\/findings-\d{4}-\d{2}-\d{2}-\d{4}\.md$/)

      const md = readFileSync(written.path, 'utf8')
      expect(md).toContain('# Findings — acme')
      expect(md).toContain('1 critical, 1 low')
      // Worst first, with the evidence fenced and the asset named by value.
      expect(md.indexOf('[CRITICAL] AWS key in bundle.js')).toBeLessThan(md.indexOf('[LOW] Directory listing'))
      expect(md).toContain('**Target:** example.com')
      expect(md).toContain('```\nAKIAEXAMPLE\n```')
    })

    it('exports what the filter shows, and says which filter that was', async () => {
      await send('/api/findings', 'POST', { title: 'a critical thing', severity: 'critical' })
      const low = (await (
        await send('/api/findings', 'POST', { title: 'a low thing', severity: 'low' })
      ).json()) as WireFinding
      await send(`/api/findings/${low.id}`, 'PATCH', { status: 'fixed' })

      const res = await send('/api/findings/report?status=fixed', 'POST')
      const written = (await res.json()) as { path: string; count: number }
      expect(written.count).toBe(1)

      const md = readFileSync(written.path, 'utf8')
      expect(md).toContain('_Filtered: status = fixed._')
      expect(md).toContain('a low thing')
      expect(md).not.toContain('a critical thing')
    })

    it('writes an honest empty report rather than failing', async () => {
      const res = await send('/api/findings/report', 'POST')
      const written = (await res.json()) as { path: string; count: number }
      expect(written.count).toBe(0)
      expect(readFileSync(written.path, 'utf8')).toContain('Nothing recorded yet.')
    })
  })
})
