import { mkdtempSync, rmSync } from 'node:fs'
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

function seedWorkflow(id: string): void {
  project.workflows.create('wf', JSON.stringify({ nodes: [], edges: [] }), { id })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-scheduleroutes-'))
  project = createProject(root, { name: 'acme' })
  seedWorkflow('wf-1')
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  app.scheduler.stop()
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { authorization: `Bearer ${TOKEN}` }
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('schedule routes', () => {
  it('rejects an interval schedule without a positive intervalSeconds', async () => {
    const res = await app.request('/api/schedules', json({ workflowId: 'wf-1', kind: 'interval' }))
    expect(res.status).toBe(400)
  })

  it('rejects an on_create schedule without a targetKind', async () => {
    const res = await app.request('/api/schedules', json({ workflowId: 'wf-1', kind: 'on_create' }))
    expect(res.status).toBe(400)
  })

  it('rejects a schedule for an unknown workflow', async () => {
    const res = await app.request('/api/schedules', json({ workflowId: 'nope', kind: 'interval', intervalSeconds: 60 }))
    expect(res.status).toBe(400)
  })

  it('creates, lists, toggles and deletes a schedule', async () => {
    const created = await app.request(
      '/api/schedules',
      json({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 3600 }),
    )
    expect(created.status).toBe(201)
    const schedule = (await created.json()) as { id: string; enabled: boolean }
    expect(schedule.enabled).toBe(true)

    const listed = await app.request('/api/schedules', { headers: auth })
    expect(((await listed.json()) as unknown[]).length).toBe(1)

    const patched = await app.request(`/api/schedules/${schedule.id}`, {
      ...json({ enabled: false }),
      method: 'PATCH',
    })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { enabled: boolean }).enabled).toBe(false)

    const del = await app.request(`/api/schedules/${schedule.id}`, { method: 'DELETE', headers: auth })
    expect(del.status).toBe(200)
    const after = await app.request('/api/schedules', { headers: auth })
    expect(((await after.json()) as unknown[]).length).toBe(0)
  })
})
