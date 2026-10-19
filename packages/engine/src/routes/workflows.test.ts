import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'

async function readJson<T>(res: { json(): Promise<unknown> }): Promise<T> {
  return (await res.json()) as T
}

type WorkflowId = { id: string }
type NamedWorkflow = { id: string; name: string }
type WorkflowWithGraph = { name: string; graph: { nodes: unknown[]; edges: unknown[] } }

const TOKEN = 'wf-token-wf-token-wf-token-wf-tok'
const auth = { headers: { authorization: `Bearer ${TOKEN}` } }
const jsonHeaders = { ...auth.headers, 'content-type': 'application/json' }

let dir: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-wf-'))
  project = createProject(dir, { name: 'test' })
  const bundled = loadManifests(bundledManifestsDir())
  const registry = new NodeRegistry(bundled)
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const validGraph = { nodes: [{ id: 'a', type: 'httpx', data: {} }], edges: [] }

describe('workflows CRUD', () => {
  it('serves a saved workflow to another engagement', async () => {
    const created = await readJson<WorkflowId>(
      await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'shared', graph: validGraph }) }),
    )

    // A second engagement, with its own engine, sees the same library.
    const otherDir = mkdtempSync(join(tmpdir(), 'exe-wf-other-'))
    const other = createProject(otherDir, { name: 'other' })
    const otherApp = createApp({
      project: other,
      token: TOKEN,
      bus: new EventBus(),
      registry: new NodeRegistry(loadManifests(bundledManifestsDir())),
      executor: new Executor(other, new EventBus()),
    })

    const listed = await readJson<NamedWorkflow[]>(await otherApp.request('/api/workflows', auth))
    expect(listed.map((w) => w.name)).toEqual(['shared'])
    const fetched = await readJson<WorkflowWithGraph>(await otherApp.request(`/api/workflows/${created.id}`, auth))
    expect(fetched.graph.nodes).toHaveLength(1)

    other.close()
    rmSync(otherDir, { recursive: true, force: true })
  })

  it('creates a workflow and returns its id', async () => {
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'recon', graph: validGraph }),
    })
    expect(res.status).toBe(201)
    const body = await readJson<NamedWorkflow>(res)
    expect(body.id).toBeTruthy()
    expect(body.name).toBe('recon')
  })

  it('rejects a graph with a cycle', async () => {
    const cyclic = {
      nodes: [{ id: 'a', type: 'x', data: {} }, { id: 'b', type: 'x', data: {} }],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    }
    const res = await app.request('/api/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'bad', graph: cyclic }),
    })
    expect(res.status).toBe(400)
  })

  it('reads a workflow back', async () => {
    const created = await readJson<WorkflowId>(
      await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'r', graph: validGraph }) })
    )
    const res = await app.request(`/api/workflows/${created.id}`, auth)
    expect(res.status).toBe(200)
    const body = await readJson<WorkflowWithGraph>(res)
    expect(body.graph.nodes).toHaveLength(1)
  })

  it('updates a workflow graph', async () => {
    const created = await readJson<WorkflowId>(
      await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'r', graph: validGraph }) })
    )
    const updated = {
      nodes: [{ id: 'a', type: 'httpx', data: {} }, { id: 'b', type: 'nuclei', data: {} }],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    }
    const res = await app.request(`/api/workflows/${created.id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'r', graph: updated }),
    })
    expect(res.status).toBe(200)
    const reread = await readJson<WorkflowWithGraph>(await app.request(`/api/workflows/${created.id}`, auth))
    expect(reread.graph.nodes).toHaveLength(2)
  })

  it('lists workflows', async () => {
    await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'a', graph: validGraph }) })
    await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'b', graph: validGraph }) })
    const list = await readJson<unknown[]>(await app.request('/api/workflows', auth))
    expect(list).toHaveLength(2)
  })

  it('404s reading an unknown workflow', async () => {
    const res = await app.request('/api/workflows/ghost', auth)
    expect(res.status).toBe(404)
  })

  it('deletes an existing workflow', async () => {
    const created = await readJson<WorkflowId>(
      await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'r', graph: validGraph }) })
    )
    const res = await app.request(`/api/workflows/${created.id}`, { method: 'DELETE', ...auth })
    expect(res.status).toBe(200)
    const body = await readJson<{ ok: boolean }>(res)
    expect(body.ok).toBe(true)
    const reread = await app.request(`/api/workflows/${created.id}`, auth)
    expect(reread.status).toBe(404)
  })

  it('404s deleting an unknown workflow', async () => {
    const res = await app.request('/api/workflows/ghost', { method: 'DELETE', ...auth })
    expect(res.status).toBe(404)
  })

  /** The run each workflow's seeded execution was given, keyed by workflow id. */
  const seeded = new Map<string, string>()
  const seedExec = (workflowId: string): void => {
    const run = project.runs.createExecution({ workflowId, targetId: null, backend: 'local', testMode: false })
    project.runs.finishExecution(run.id, 'succeeded')
    seeded.set(workflowId, run.id)
  }
  const execRow = (id: string): { workflowId: string | null } | undefined =>
    project.runs.getExecution(seeded.get(id) ?? '')

  it('cascades executions on delete by default', async () => {
    const created = await readJson<WorkflowId>(
      await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'r', graph: validGraph }) })
    )
    seedExec(created.id)
    await app.request(`/api/workflows/${created.id}`, { method: 'DELETE', ...auth })
    expect(execRow(created.id)).toBeUndefined()
  })

  it('keeps run history (detaches executions) when keepHistory=true', async () => {
    const created = await readJson<WorkflowId>(
      await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'r', graph: validGraph }) })
    )
    seedExec(created.id)
    await app.request(`/api/workflows/${created.id}?keepHistory=true`, { method: 'DELETE', ...auth })
    expect(execRow(created.id)?.workflowId).toBeNull()
  })

  it('duplicates a workflow with a copy name and identical graph', async () => {
    const created = await readJson<WorkflowId>(
      await app.request('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: 'recon', graph: validGraph }) })
    )
    const res = await app.request(`/api/workflows/${created.id}/duplicate`, { method: 'POST', ...auth })
    expect(res.status).toBe(201)
    const body = await readJson<NamedWorkflow>(res)
    expect(body.id).toBeTruthy()
    expect(body.id).not.toBe(created.id)
    expect(body.name).toBe('recon (copy)')
    const copy = await readJson<WorkflowWithGraph>(await app.request(`/api/workflows/${body.id}`, auth))
    expect(copy.graph).toEqual(validGraph)
    const original = await readJson<NamedWorkflow>(await app.request(`/api/workflows/${created.id}`, auth))
    expect(original.name).toBe('recon')
  })

  it('404s duplicating an unknown workflow', async () => {
    const res = await app.request('/api/workflows/ghost/duplicate', { method: 'POST', ...auth })
    expect(res.status).toBe(404)
  })
})
