import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'
import type { RunRepository } from '@exe/db'

const TOKEN = 'a'.repeat(40)
/**
 * Polls a run's state until it holds. vi.waitFor gives up after 1s by default,
 * which a spawn and kill can outlast under a full-suite load; this cap only
 * stops a hung test, and a pass never waits on it.
 */
const PATIENCE = { timeout: 20_000, interval: 20 }
let root: string
let project: Project
let app: ReturnType<typeof createApp>
let store: RunRepository

/** A tool that runs until something kills it. */
const sleeper: ToolManifest = toolManifestSchema.parse({
  id: 'sleeper',
  name: 'sleeper',
  description: 'sleeps until it is killed',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], timeout_ms: 60_000 },
  emit: { parser: 'json' },
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-cancelroutes-'))
  project = createProject(root, { name: 'acme' })
  const bundled = loadManifests(bundledManifestsDir())
  bundled.set(sleeper.id, sleeper)
  const registry = new NodeRegistry(bundled)
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
  store = project.runs
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { headers: { authorization: `Bearer ${TOKEN}` } }
const post = async (path: string, body?: unknown): Promise<Response> =>
  app.request(path, {
    method: 'POST',
    headers: { ...auth.headers, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function insertWorkflow(id: string, graph: unknown): void {
  project.workflows.create('test workflow', JSON.stringify(graph), { id })
}

describe('POST /api/executions/:id/cancel', () => {
  it('guards behind the bearer token', async () => {
    const res = await app.request('/api/executions/whatever/cancel', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('404s for a run that does not exist', async () => {
    const res = await post('/api/executions/nope/cancel')
    expect(res.status).toBe(404)
  })

  it('409s for a run that already finished', async () => {
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    store.finishExecution(exec.id, 'succeeded')

    const res = await post(`/api/executions/${exec.id}/cancel`)
    expect(res.status).toBe(409)
    expect(store.getExecution(exec.id)?.status).toBe('succeeded')
  })

  it('stops a live run and reports it cancelled', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    insertWorkflow('wf-cancel', { nodes: [{ id: 'a', type: 'sleeper', data: {} }], edges: [] })

    // Step mode returns as soon as the run is registered, so the test holds the
    // execution id while the run is still going.
    const started = await post('/api/workflows/wf-cancel/run', { targetId: target.id, mode: 'step' })
    const { executionId } = (await started.json()) as { executionId: string }
    await post(`/api/executions/${executionId}/resume`)

    await vi.waitFor(() => {
      expect(store.nodesFor(executionId).some((n) => n.status === 'running')).toBe(true)
    }, PATIENCE)

    const res = await post(`/api/executions/${executionId}/cancel`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'cancelled' })

    await vi.waitFor(() => {
      expect(store.getExecution(executionId)?.status).toBe('cancelled')
    }, PATIENCE)
    expect(store.nodesFor(executionId).every((n) => n.status !== 'running')).toBe(true)
  }, 60_000)

  it('settles a run left behind by an engine that died under it', async () => {
    // No live run backs this row — exactly what a crashed engine leaves.
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })

    const res = await post(`/api/executions/${exec.id}/cancel`)
    expect(res.status).toBe(200)
    const settled = store.getExecution(exec.id)
    expect(settled?.status).toBe('cancelled')
    expect(settled?.finishedAt).not.toBeNull()
  })
})
