import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

// Stand-in tool manifest backed by node, so no security binaries are needed.
const emitHost: ToolManifest = toolManifestSchema.parse({
  id: 'emit-host',
  name: 'emit-host',
  description: 'emits the target host as a JSON record',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({host: process.argv[1]}))', '{{ target.value }}'],
  },
  emit: { parser: 'json' },
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-execroutes-'))
  project = createProject(root, { name: 'acme' })
  const bundled = loadManifests(bundledManifestsDir())
  bundled.set(emitHost.id, emitHost)
  const registry = new NodeRegistry(bundled)
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { headers: { authorization: `Bearer ${TOKEN}` } }

function insertWorkflow(id: string, graph: unknown): void {
  project.workflows.create('test workflow', JSON.stringify(graph), { id })
}

describe('POST /api/workflows/:id/run', () => {
  it('runs a stored single-node workflow against a target', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = { nodes: [{ id: 'a', type: 'emit-host', data: {} }], edges: [] }
    insertWorkflow('wf-1', graph)

    const res = await app.request('/api/workflows/wf-1/run', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: target.id, testMode: false }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; executionId: string }
    expect(body.status).toBe('succeeded')
    expect(typeof body.executionId).toBe('string')
  })

  it('404s an unknown workflow', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const res = await app.request('/api/workflows/nope/run', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: target.id, testMode: false }),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/executions/:id', () => {
  it('returns the execution with its per-node results', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = { nodes: [{ id: 'a', type: 'emit-host', data: {} }], edges: [] }
    insertWorkflow('wf-2', graph)

    const runRes = await app.request('/api/workflows/wf-2/run', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: target.id, testMode: false }),
    })
    const { executionId } = (await runRes.json()) as { executionId: string }

    const res = await app.request(`/api/executions/${executionId}`, auth)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; nodes: Array<{ nodeId: string }> }
    expect(body.status).toBe('succeeded')
    expect(body.nodes).toHaveLength(1)
    expect(body.nodes[0]?.nodeId).toBe('a')
  })
})
