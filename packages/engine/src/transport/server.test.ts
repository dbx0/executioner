import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { createApp } from './server.js'
import { EventBus } from './events.js'
import { Executor } from '../execution/executor.js'

let dir: string
let project: Project
let app: ReturnType<typeof createApp>
const TOKEN = 'test-token-test-token-test-token'

async function readJson<T>(res: { json(): Promise<unknown> }): Promise<T> {
  return (await res.json()) as T
}

const auth = { headers: { authorization: `Bearer ${TOKEN}` } }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-server-'))
  project = createProject(dir, { name: 'test' })
  const bus = new EventBus()
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, bus)
  app = createApp({ project, token: TOKEN, bus, registry, executor })
})

afterEach(async () => {
  // No scheduled run may still be writing when the database closes.
  app.scheduler.stop()
  await app.scheduler.idle()
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('GET /health', () => {
  it('is reachable without a token', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('unexpected errors', () => {
  it('answer with a generic JSON error rather than the internal message', async () => {
    project.workflows.create('broken', 'not json at all', { id: 'wf-broken' })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const res = await app.request('/api/workflows/wf-broken', auth)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'internal error' })
    } finally {
      stderr.mockRestore()
    }
  })
})

describe('origin and host guards', () => {
  it('refuses a request addressed to a non-loopback host, as DNS rebinding produces', async () => {
    const res = await app.request('/api/targets', { headers: { ...auth.headers, host: 'attacker.example:4100' } })
    expect(res.status).toBe(403)
  })

  it('serves a request addressed to loopback', async () => {
    const res = await app.request('/api/targets', { headers: { ...auth.headers, host: '127.0.0.1:4100' } })
    expect(res.status).toBe(200)
  })

  it('grants CORS to the packaged renderer and the loopback dev server only', async () => {
    const allowed = async (origin: string): Promise<string | null> =>
      (await app.request('/api/targets', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET' } }))
        .headers.get('access-control-allow-origin')
    expect(await allowed('null')).toBe('null')
    expect(await allowed('http://localhost:61337')).toBe('http://localhost:61337')
    expect(await allowed('https://evil.example')).toBeNull()
  })
})

describe('auth', () => {
  it('rejects a request with no token', async () => {
    const res = await app.request('/api/targets')
    expect(res.status).toBe(401)
  })

  it('rejects a request with a wrong token', async () => {
    const res = await app.request('/api/targets', { headers: { authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/targets', () => {
  it('creates a target', async () => {
    const res = await app.request('/api/targets', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'domain', value: 'example.com', source: 'manual' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ value: 'example.com', kind: 'domain' })
  })

  it('is idempotent and returns 200 on re-discovery', async () => {
    const body = JSON.stringify({ kind: 'domain', value: 'example.com', source: 'manual' })
    const headers = { ...auth.headers, 'content-type': 'application/json' }
    await app.request('/api/targets', { method: 'POST', headers, body })
    const second = await app.request('/api/targets', { method: 'POST', headers, body })
    expect(second.status).toBe(200)
    const list = await (await app.request('/api/targets', auth)).json()
    expect(list).toHaveLength(1)
  })

  it('rejects an invalid kind with 400', async () => {
    const res = await app.request('/api/targets', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'planet', value: 'x', source: 'manual' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('on_create schedules', () => {
  const headers = { ...auth.headers, 'content-type': 'application/json' }

  /** Insert a runnable (empty-graph) workflow row the schedule can reference. */
  function seedWorkflow(id: string): void {
    project.workflows.create('wf', JSON.stringify({ nodes: [], edges: [] }), { id })
  }

  async function executions(): Promise<Array<{ workflowId: string; targetId: string | null }>> {
    return readJson<Array<{ workflowId: string; targetId: string | null }>>(
      await app.request('/api/executions', auth),
    )
  }

  it('runs the workflow when a matching target is added via POST /targets', async () => {
    seedWorkflow('wf-1')
    app.scheduler.start()
    await app.request('/api/schedules', {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' }),
    })

    const target = await readJson<{ id: string }>(
      await app.request('/api/targets', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'domain', value: 'example.com', source: 'manual' }),
      }),
    )

    // The run is fired and forgotten; wait for it to finish, not for a guess.
    await app.scheduler.idle()
    const runs = await executions()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ workflowId: 'wf-1', targetId: target.id })
  })

  it('does not run when the added target kind does not match', async () => {
    seedWorkflow('wf-1')
    app.scheduler.start()
    await app.request('/api/schedules', {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'ip' }),
    })
    await app.request('/api/targets', {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'domain', value: 'example.com', source: 'manual' }),
    })
    // The run is fired and forgotten; wait for it to finish, not for a guess.
    await app.scheduler.idle()
    expect(await executions()).toHaveLength(0)
  })

  it('fires on_create for targets discovered by tool nodes (emit path), not just the HTTP route', async () => {
    seedWorkflow('wf-1')
    app.scheduler.start()
    await app.request('/api/schedules', {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'subdomain' }),
    })

    // A tool node discovers a subdomain by calling the repository directly,
    // bypassing POST /targets. This is the case that previously never triggered.
    const discovered = project.targets.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'workflow' })

    // The run is fired and forgotten; wait for it to finish, not for a guess.
    await app.scheduler.idle()
    const runs = await executions()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ workflowId: 'wf-1', targetId: discovered.id })
  })
})

describe('GET /api/targets/tree', () => {
  it('returns targets nested under their parent', async () => {
    const headers = { ...auth.headers, 'content-type': 'application/json' }
    const parent = await readJson<{ id: string }>(
      await app.request('/api/targets', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'domain', value: 'example.com', source: 'manual' }),
      }),
    )
    await app.request('/api/targets', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 'subdomain',
        value: 'api.example.com',
        source: 'manual',
        parentId: parent.id,
      }),
    })

    const tree = await readJson<Array<{ children: Array<{ value: string }> }>>(
      await app.request('/api/targets/tree', auth),
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children[0]!.value).toBe('api.example.com')
  })
})
