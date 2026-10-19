import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createProject, type Project } from '@exe/project'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { scopeRoutes } from './scope.js'

let root: string
let project: Project
let bus: EventBus

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-scoperoutes-'))
  project = createProject(root, { name: 'acme' })
  bus = new EventBus()
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

/** Resolve once a `scope-done` event fires (the run finished). */
function waitForDone(b: EventBus): Promise<EngineEvent> {
  return new Promise((resolve) => {
    const off = b.subscribe((e) => {
      if (e.type === 'agent' && e.nodeId === 'scope-done') {
        off()
        resolve(e)
      }
    })
  })
}

describe('POST /scope/parse', () => {
  it('returns a runId and registers the targets the agent adds', async () => {
    // The agent is the only parser: the injected step registers the in-scope hosts.
    const app = new Hono().route(
      '/',
      scopeRoutes({
        project,
        bus,
        buildRunAgent: () => async () => {
          project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'agent' })
          project.targets.upsert({ kind: 'subdomain', value: 'api.example.com', source: 'agent' })
        },
      }),
    )
    const done = waitForDone(bus)
    const res = await app.request('/scope/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'api.example.com (and its parent)' }),
    })
    expect(res.status).toBe(202)
    const payload = (await res.json()) as { runId: string }
    expect(typeof payload.runId).toBe('string')

    const doneEvent = await done
    expect(doneEvent.executionId).toBe(payload.runId)
    const values = project.targets.all().map((t) => t.value).sort()
    expect(values).toEqual(['api.example.com', 'example.com'])
  })

  it('adds no targets when no capable agent is available (no regex fallback)', async () => {
    const app = new Hono().route('/', scopeRoutes({ project, bus }))
    const done = waitForDone(bus)
    await app.request('/scope/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: '*.example.com api.example.com john@bugcrowdninja.com' }),
    })
    await done
    expect(project.targets.all()).toHaveLength(0)
  })

  it('400s on an empty body', async () => {
    const app = new Hono().route('/', scopeRoutes({ project, bus }))
    const res = await app.request('/scope/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('invokes the injected agent step before parsing', async () => {
    let called = false
    const app = new Hono().route(
      '/',
      scopeRoutes({
        project,
        bus,
        buildRunAgent: (agent) => (agent === 'claude' ? async () => { called = true } : undefined),
      }),
    )
    const done = waitForDone(bus)
    await app.request('/scope/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'x.example.com', agent: 'claude' }),
    })
    await done
    expect(called).toBe(true)
  })
})
