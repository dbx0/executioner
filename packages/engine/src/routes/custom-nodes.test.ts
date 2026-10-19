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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-customnodes-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { authorization: `Bearer ${TOKEN}` }
const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// A custom node backed by node, so the graph can run with no security binaries.
const emitHost = {
  id: 'my-scanner',
  name: 'My Scanner',
  description: 'emits the target host as a JSON record',
  category: 'custom',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({host: process.argv[1]}))', '{{ target.value }}'],
  },
  emit: { parser: 'json' },
}

describe('custom node routes', () => {
  it('rejects an invalid tool manifest', async () => {
    const res = await app.request('/api/custom-nodes', json({ id: 'Bad Id', name: '' }))
    expect(res.status).toBe(400)
  })

  it('creates, lists, updates and deletes a custom node', async () => {
    const created = await app.request('/api/custom-nodes', json(emitHost))
    expect(created.status).toBe(201)
    const listed = await app.request('/api/custom-nodes', { headers: auth })
    expect(((await listed.json()) as unknown[]).length).toBe(1)

    const updated = await app.request('/api/custom-nodes/my-scanner', json({ ...emitHost, name: 'Renamed' }, 'PUT'))
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { name: string }).name).toBe('Renamed')

    const del = await app.request('/api/custom-nodes/my-scanner', { method: 'DELETE', headers: auth })
    expect(del.status).toBe(200)
    const after = await app.request('/api/custom-nodes', { headers: auth })
    expect(((await after.json()) as unknown[]).length).toBe(0)
  })

  it('rejects a custom node whose id collides with a bundled node', async () => {
    const res = await app.request('/api/custom-nodes', json({ ...emitHost, id: 'nmap' }))
    expect(res.status).toBe(400)
  })

  it('rejects a duplicate custom node id', async () => {
    await app.request('/api/custom-nodes', json(emitHost))
    const dup = await app.request('/api/custom-nodes', json(emitHost))
    expect(dup.status).toBe(409)
  })

  it('includes a created custom node in GET /api/nodes', async () => {
    await app.request('/api/custom-nodes', json(emitHost))
    const res = await app.request('/api/nodes', { headers: auth })
    const body = (await res.json()) as { id: string }[]
    expect(body.map((n) => n.id)).toContain('my-scanner')
  })

  it('runs a workflow graph whose node type is a custom node id', async () => {
    await app.request('/api/custom-nodes', json(emitHost))
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    project.workflows.create('wf', JSON.stringify({ nodes: [{ id: 'a', type: 'my-scanner', data: {} }], edges: [] }), { id: 'wf-c' })

    const res = await app.request('/api/workflows/wf-c/run', json({ targetId: target.id }))
    expect(res.status).toBe(200)
    const result = (await res.json()) as { executionId: string; status: string }
    expect(result.status).toBe('succeeded')

    const exec = await app.request(`/api/executions/${result.executionId}`, { headers: auth })
    const detail = (await exec.json()) as { nodes: { nodeId: string; parsedOutput: unknown }[] }
    const node = detail.nodes.find((n) => n.nodeId === 'a')
    expect(JSON.stringify(node?.parsedOutput ?? '')).toContain('example.com')
  })
})
