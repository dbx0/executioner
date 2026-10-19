import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'

/**
 * Proves the workflow-canvas path end to end against the real HTTP surface:
 * the graph is saved in the exact wire shape the renderer's `AutomationsView`
 * emits (reactflow nodes carrying `id`/`type`/`data`/`position` and edges
 * carrying `id`/`source`/`target`/`sourceHandle`), then run, then polled for
 * per-node status — and the live event bus the canvas paints from is asserted
 * to carry a `running` + terminal `done` frame for every node.
 */

const TOKEN = 'c'.repeat(40)
let root: string
let project: Project
let bus: EventBus
let app: ReturnType<typeof createApp>

// Stand-in tool manifest backed by node so no security binaries are needed.
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
  root = mkdtempSync(join(tmpdir(), 'exe-canvas-'))
  project = createProject(root, { name: 'acme' })
  const bundled = loadManifests(bundledManifestsDir())
  bundled.set(emitHost.id, emitHost)
  const registry = new NodeRegistry(bundled)
  bus = new EventBus()
  const executor = new Executor(project, bus)
  app = createApp({ project, token: TOKEN, bus, registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { headers: { authorization: `Bearer ${TOKEN}` } }
const json = (body: unknown) => ({
  method: 'POST',
  headers: { ...auth.headers, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('workflow canvas: save → run → live per-node status', () => {
  it('accepts the renderer graph shape, runs a connected two-node graph, and emits live status', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })

    // Exactly what AutomationsView.save() posts: node.type is the manifest id,
    // node.data is the flat param record, plus reactflow position; edges carry a
    // nullable sourceHandle. The engine's graphSchema tolerates position via
    // passthrough.
    const graph = {
      nodes: [
        { id: 'emit-host-1', type: 'emit-host', data: {}, position: { x: 160, y: 80 } },
        { id: 'emit-host-2', type: 'emit-host', data: {}, position: { x: 360, y: 80 } },
      ],
      edges: [{ id: 'e1', source: 'emit-host-1', target: 'emit-host-2', sourceHandle: null }],
    }

    // Save through the real create route the renderer calls.
    const created = await app.request('/api/workflows', json({ name: 'canvas flow', graph }))
    expect(created.status).toBe(201)
    const { id: workflowId } = (await created.json()) as { id: string }

    // Capture the live event stream the canvas subscribes to over /events.
    const seen: EngineEvent[] = []
    const unsubscribe = bus.subscribe((e) => seen.push(e))

    const runRes = await app.request(`/api/workflows/${workflowId}/run`, json({ targetId: target.id }))
    unsubscribe()
    expect(runRes.status).toBe(200)
    const runBody = (await runRes.json()) as { status: string; executionId: string }
    expect(runBody.status).toBe('succeeded')

    // Per-node status is queryable for the canvas to reconcile against.
    const execRes = await app.request(`/api/executions/${runBody.executionId}`, auth)
    const exec = (await execRes.json()) as { status: string; nodes: Array<{ nodeId: string; status: string }> }
    expect(exec.status).toBe('succeeded')
    const byNode = Object.fromEntries(exec.nodes.map((n) => [n.nodeId, n.status]))
    expect(byNode).toEqual({ 'emit-host-1': 'succeeded', 'emit-host-2': 'succeeded' })

    // The live frames the canvas paints from: each node goes running then done.
    for (const nodeId of ['emit-host-1', 'emit-host-2']) {
      expect(seen.some((e) => e.nodeId === nodeId && e.type === 'status' && e.data === 'running')).toBe(true)
      expect(seen.some((e) => e.nodeId === nodeId && e.type === 'done' && e.data === 'succeeded')).toBe(true)
    }
  })
})
