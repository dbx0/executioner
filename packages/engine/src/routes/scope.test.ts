import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createProject, type Project } from '@exe/project'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { scopeRoutes } from './scope.js'
import { AgentSessionSinks } from '../mcp/agent-sessions.js'
import { ProjectToolset, type ToolsetDeps } from '../mcp/toolset.js'

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

describe('POST /scope/parse with propose', () => {
  it('leaves the project untouched and reports the proposal in scope-done', async () => {
    const toolsetDeps: ToolsetDeps = { project, runWorkflow: async () => ({ executionId: 'x', status: 'success' }) }
    const toolset = new ProjectToolset(toolsetDeps)
    const app = new Hono().route(
      '/',
      scopeRoutes({
        project,
        bus,
        toolsetDeps,
        buildRunAgent: (_agent, runId) => async () => {
          const caller = { profile: 'scope' as const, sessionId: runId }
          await toolset.call('add_scope_rule', { effect: 'include', pattern: '*.example.com' }, caller)
          await toolset.call('upsert_target', { kind: 'subdomain', value: 'api.example.com' }, caller)
        },
      }),
    )
    const done = waitForDone(bus)
    const res = await app.request('/scope/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: '*.example.com', propose: true }),
    })
    expect(res.status).toBe(202)
    const event = await done
    const payload = JSON.parse((event as { data: string }).data) as {
      proposal: { rules: unknown[]; targets: unknown[] }
    }
    expect(payload.proposal).toEqual({
      rules: [{ effect: 'include', pattern: '*.example.com' }],
      targets: [{ kind: 'subdomain', value: 'api.example.com' }],
    })
    expect(project.scopeRules.all()).toEqual([])
    expect(project.targets.all()).toEqual([])
    expect(toolsetDeps.sessions?.size).toBe(0)
  })

  it('unbinds the draft even when the agent throws', async () => {
    const toolsetDeps: ToolsetDeps = { project, runWorkflow: async () => ({ executionId: 'x', status: 'success' }) }
    toolsetDeps.sessions = new AgentSessionSinks()
    const app = new Hono().route(
      '/',
      scopeRoutes({
        project,
        bus,
        toolsetDeps,
        buildRunAgent: () => async () => {
          throw new Error('boom')
        },
      }),
    )
    const done = waitForDone(bus)
    await app.request('/scope/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'x', propose: true }),
    })
    await done
    expect(toolsetDeps.sessions.size).toBe(0)
  })
})

describe('POST /scope/apply', () => {
  const post = (app: Hono, payload: unknown): Promise<Response> =>
    Promise.resolve(
      app.request('/scope/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    )

  it('POST /scope/apply writes rules and targets and returns the split', async () => {
    const app = new Hono().route('/', scopeRoutes({ project, bus }))
    const res = await post(app, {
      rules: [
        { effect: 'include', pattern: '*.example.com', note: 'main' },
        { effect: 'exclude', pattern: 'shop.example.com' },
      ],
      targets: [
        { kind: 'subdomain', value: 'api.example.com' },
        { kind: 'subdomain', value: 'shop.example.com' },
      ],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, number>
    expect(body).toMatchObject({ rulesAdded: 2, targetsAdded: 2, inScope: 2, outOfScope: 1 })
    expect(typeof body.rejudged).toBe('number')
    expect(project.scopeRules.all().map((r) => r.source)).toEqual(['agent', 'agent'])
    expect(project.targets.findByValue('subdomain', 'shop.example.com')?.scopeStatus).toBe('out')
  })

  it('saves nothing when a write fails part way', async () => {
    const app = new Hono().route('/', scopeRoutes({ project, bus }))
    const upsert = project.targets.upsert.bind(project.targets)
    let calls = 0
    vi.spyOn(project.targets, 'upsert').mockImplementation((input) => {
      calls++
      if (calls === 2) throw new Error('disk full')
      return upsert(input)
    })
    const res = await post(app, {
      rules: [{ effect: 'include', pattern: '*.example.com' }],
      targets: [
        { kind: 'subdomain', value: 'api.example.com' },
        { kind: 'subdomain', value: 'www.example.com' },
      ],
    })
    expect(res.status).toBe(500)
    expect(project.scopeRules.all()).toEqual([])
    expect(project.targets.findByValue('subdomain', 'api.example.com')).toBeUndefined()
  })

  it('does not count rules and targets that already exist', async () => {
    const app = new Hono().route('/', scopeRoutes({ project, bus }))
    const payload = { rules: [{ effect: 'include', pattern: 'example.com' }], targets: [{ kind: 'domain', value: 'example.com' }] }
    await post(app, payload)
    const again = (await (await post(app, payload)).json()) as Record<string, number>
    expect(again).toMatchObject({ rulesAdded: 0, targetsAdded: 0 })
  })

  it('400s on an invalid effect or kind', async () => {
    const app = new Hono().route('/', scopeRoutes({ project, bus }))
    expect((await post(app, { rules: [{ effect: 'maybe', pattern: 'x.com' }], targets: [] })).status).toBe(400)
    expect((await post(app, { rules: [], targets: [{ kind: 'galaxy', value: 'x.com' }] })).status).toBe(400)
    expect(project.scopeRules.all()).toEqual([])
  })

  it('400s without writing when a rule pattern is unusable', async () => {
    const app = new Hono().route('/', scopeRoutes({ project, bus }))
    const res = await post(app, {
      rules: [
        { effect: 'include', pattern: 'ok.example.com' },
        { effect: 'exclude', pattern: 'class:denial-of-service' },
      ],
      targets: [],
    })
    expect(res.status).toBe(400)
    expect(project.scopeRules.all()).toEqual([])
  })
})
