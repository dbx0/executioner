import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { globalLayout } from '@exe/protocol'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { Hono } from 'hono'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'
import { backendRoutes } from './backends.js'
import type { EnrollResult } from '../infra/ssh-enroll.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-backendroutes-'))
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
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('backend profile routes', () => {
  it('serves a saved connection to another engagement', async () => {
    await app.request('/api/backends', json({ name: 'scanbox', kind: 'ssh', host: 'h', user: 'u' }))

    // A second engagement, with its own engine, reads the same connections.
    const otherRoot = mkdtempSync(join(tmpdir(), 'exe-backendroutes-other-'))
    const other = createProject(otherRoot, { name: 'globex' })
    const otherApp = createApp({
      project: other,
      token: TOKEN,
      bus: new EventBus(),
      registry: new NodeRegistry(loadManifests(bundledManifestsDir())),
      executor: new Executor(other, new EventBus()),
    })

    const listed = (await (await otherApp.request('/api/backends', { headers: auth })).json()) as Array<{ name: string }>
    expect(listed.map((p) => p.name)).toEqual(['scanbox'])

    other.close()
    rmSync(otherRoot, { recursive: true, force: true })
  })

  it('rejects an ssh profile missing host/user', async () => {
    const res = await app.request('/api/backends', json({ name: 'bad', kind: 'ssh' }))
    expect(res.status).toBe(400)
  })

  it('creates, lists, updates and deletes an ssh profile', async () => {
    const created = await app.request('/api/backends', json({ name: 'scanbox', kind: 'ssh', host: 'h', user: 'u', port: 22 }))
    expect(created.status).toBe(201)
    const profile = (await created.json()) as { id: string; kind: string; host: string }
    expect(profile.kind).toBe('ssh')
    expect(profile.host).toBe('h')

    const listed = await app.request('/api/backends', { headers: auth })
    expect(((await listed.json()) as unknown[]).length).toBe(1)

    const updated = await app.request(`/api/backends/${profile.id}`, {
      ...json({ name: 'scanbox2', kind: 'ssh', host: 'h2', user: 'u' }),
      method: 'PUT',
    })
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { name: string }).name).toBe('scanbox2')

    const del = await app.request(`/api/backends/${profile.id}`, { method: 'DELETE', headers: auth })
    expect(del.status).toBe(200)
    const after = await app.request('/api/backends', { headers: auth })
    expect(((await after.json()) as unknown[]).length).toBe(0)
  })

  it('tests a local profile as ok without spawning anything', async () => {
    const res = await app.request('/api/backends/test', json({ name: 'here', kind: 'local' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; steps: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.steps).toHaveLength(1)
  })

  it('rejects a test for an invalid profile', async () => {
    const res = await app.request('/api/backends/test', json({ name: 'bad', kind: 'ssh' }))
    expect(res.status).toBe(400)
  })

  it('rejects ssh-enroll with a missing password', async () => {
    const res = await app.request('/api/backends/ssh-enroll', json({ host: 'h', user: 'u' }))
    expect(res.status).toBe(400)
  })

  it('enrolls a generated key (enroll fn stubbed) and returns the identity file', async () => {
    const stub = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        identityFile: `${root}/.executioner/ssh/u@h.key`,
        steps: [
          { name: 'Generate key', ok: true },
          { name: 'Install key', ok: true },
          { name: 'Verify', ok: true },
        ],
      } satisfies EnrollResult)
    const routed = new Hono().route('/api', backendRoutes(project, stub))
    const res = await routed.request('/api/backends/ssh-enroll', json({ host: 'h', user: 'u', password: 'p', port: 2222 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as EnrollResult
    expect(body.ok).toBe(true)
    expect(body.identityFile).toContain('.executioner/ssh/u@h.key')
    expect(stub).toHaveBeenCalledOnce()
    const arg = stub.mock.calls[0]?.[0] as { host: string; user: string; password: string; keyDir: string; port?: number }
    expect(arg).toMatchObject({ host: 'h', user: 'u', password: 'p', port: 2222 })
    // The key is user-level, like the connection it belongs to.
    expect(arg.keyDir).toBe(globalLayout.sshKeys())
  })

  it('rejects a run against an unknown backend profile', async () => {
    project.workflows.create('wf', JSON.stringify({ nodes: [], edges: [] }), { id: 'wf-b' })
    const res = await app.request(
      '/api/workflows/wf-b/run',
      json({ targetId: 't1', backendProfileId: 'does-not-exist' }),
    )
    expect(res.status).toBe(400)
  })
})
