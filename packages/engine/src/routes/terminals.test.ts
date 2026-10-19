import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'
import { Hono } from 'hono'
import { terminalRoutes, type TerminalRequest } from './terminals.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-terminalroutes-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({
    project,
    token: TOKEN,
    bus: new EventBus(),
    registry,
    executor,
    createTerminal: () => ({ id: 'term-1' }),
  })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

describe('POST /api/terminals', () => {
  it('refuses a malformed request, or a prompt or resume id that would read as a CLI flag', async () => {
    let called = false
    const routed = new Hono()
    routed.route(
      '/',
      terminalRoutes(() => {
        called = true
        return { id: 'never' }
      }),
    )
    for (const body of [
      { kind: 'root-shell' },
      { agent: 42 },
      { prompt: '--dangerously-skip-permissions' },
      { resume: '-c' },
    ]) {
      const res = await routed.request('/terminals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
    }
    expect(called).toBe(false)
  })

  it('creates a terminal session and returns its id', async () => {
    const res = await app.request('/api/terminals', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body).toEqual({ id: 'term-1' })
  })

  it('passes an initial prompt through to the terminal creator', async () => {
    let seen: TerminalRequest | undefined
    const routed = new Hono()
    routed.route(
      '/',
      terminalRoutes((input) => {
        seen = input
        return { id: 'term-2' }
      }),
    )
    const res = await routed.request('/terminals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'claude', prompt: 'do the thing' }),
    })
    expect(res.status).toBe(200)
    expect(seen?.prompt).toBe('do the thing')
  })

  it('401s without the bearer token', async () => {
    const res = await app.request('/api/terminals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })
})
