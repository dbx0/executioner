import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { createApp } from '../transport/server.js'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import type { BrowserItem } from '../browser/registry.js'

const TOKEN = 'test-token-test-token-test-token'

let dir: string
let project: Project
let bus: EventBus
let app: ReturnType<typeof createApp>

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const send = (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-browsers-'))
  project = createProject(dir, { name: 'test' })
  bus = new EventBus()
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  app = createApp({ project, token: TOKEN, bus, registry, executor: new Executor(project, bus) })
})

afterEach(async () => {
  app.scheduler.stop()
  await app.scheduler.idle()
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('browser routes', () => {
  it('POST then GET lists the browser', async () => {
    const created = (await (await send('POST', '/browsers', { url: 'https://a.test' })).json()) as BrowserItem
    expect(created.owner).toBeNull()
    const list = (await (await send('GET', '/browsers')).json()) as BrowserItem[]
    expect(list).toEqual([created])
  })

  it('POST with a known id returns the existing item', async () => {
    const first = (await (await send('POST', '/browsers', { id: 'b1', url: 'https://a.test' })).json()) as BrowserItem
    const again = (await (await send('POST', '/browsers', { id: 'b1' })).json()) as BrowserItem
    expect(again).toEqual(first)
    expect(((await (await send('GET', '/browsers')).json()) as BrowserItem[]).length).toBe(1)
  })

  it('PATCH owner publishes an owner event on the bus', async () => {
    await send('POST', '/browsers', { id: 'b1' })
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))
    const res = await send('PATCH', '/browsers/b1', { owner: 's1' })
    expect(((await res.json()) as BrowserItem).owner).toBe('s1')
    const owner = events.find((e) => e.type === 'browser' && e.nodeId === 'owner')
    expect(owner?.executionId).toBe('b1')
    expect(JSON.parse(owner?.data ?? '{}')).toMatchObject({ id: 'b1', owner: 's1' })
  })

  it('DELETE removes it', async () => {
    await send('POST', '/browsers', { id: 'b1' })
    expect((await send('DELETE', '/browsers/b1')).status).toBe(204)
    expect(await (await send('GET', '/browsers')).json()).toEqual([])
  })

  it('PATCH an unknown id is 404', async () => {
    expect((await send('PATCH', '/browsers/nope', { owner: 's1' })).status).toBe(404)
  })
})
