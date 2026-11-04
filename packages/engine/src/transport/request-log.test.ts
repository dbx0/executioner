import * as fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseLine, type LogLine } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { createApp } from './server.js'
import { EventBus } from './events.js'
import { Executor } from '../execution/executor.js'
import { engineLog } from '../infra/log.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeSync: vi.fn() }
})

const TOKEN = 'test-token-test-token-test-token'
const auth = { headers: { authorization: `Bearer ${TOKEN}` } }

let dir: string
let project: Project
let app: ReturnType<typeof createApp>
let bus: EventBus

/** Every request-log line written to stderr since the last clear. */
const requestLines = (): LogLine[] =>
  vi
    .mocked(fs.writeSync)
    .mock.calls.filter((c) => c[0] === 2)
    .map((c) => parseLine(String(c[1]).trim()))
    .filter((l): l is LogLine => l !== null && l.src === 'engine/http' && l.msg === 'Request')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-request-log-'))
  project = createProject(dir, { name: 'test' })
  bus = new EventBus()
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  app = createApp({ project, token: TOKEN, bus, registry, executor: new Executor(project, bus) })
  vi.mocked(fs.writeSync).mockClear()
})

afterEach(async () => {
  engineLog.setLevel('info')
  app.scheduler.stop()
  await app.scheduler.idle()
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('request log', () => {
  it('logs method, route pattern, status and duration at debug, without query values', async () => {
    engineLog.setLevel('debug')
    const res = await app.request('/api/targets?search=victim.example.com', auth)
    expect(res.status).toBe(200)
    const lines = requestLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ lvl: 'debug', data: { method: 'GET', route: '/api/targets', status: 200 } })
    expect(typeof lines[0]?.data?.ms).toBe('number')
    expect(Object.keys(lines[0]?.data ?? {}).sort()).toEqual(['method', 'ms', 'route', 'status'])
    expect(JSON.stringify(lines[0])).not.toContain('victim')
  })

  it('uses the route pattern, not the concrete path', async () => {
    engineLog.setLevel('debug')
    await app.request('/api/workflows/wf-some-id', auth)
    expect(requestLines()[0]?.data).toMatchObject({ route: '/api/workflows/:id' })
    expect(JSON.stringify(requestLines())).not.toContain('wf-some-id')
  })

  it('logs nothing for a successful request at info', async () => {
    const res = await app.request('/api/targets', auth)
    expect(res.status).toBe(200)
    expect(requestLines()).toHaveLength(0)
  })

  it('logs a 500 at warn even at info', async () => {
    project.workflows.create('broken', 'not json at all', { id: 'wf-broken' })
    const res = await app.request('/api/workflows/wf-broken', auth)
    expect(res.status).toBe(500)
    const lines = requestLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ lvl: 'warn', data: { method: 'GET', route: '/api/workflows/:id', status: 500 } })
  })
})

describe('workflow node events', () => {
  const nodeLines = (): LogLine[] =>
    vi
      .mocked(fs.writeSync)
      .mock.calls.map((c) => parseLine(String(c[1]).trim()))
      .filter((l): l is LogLine => l !== null && l.src === 'engine/workflow')

  it('logs node status and finish at debug, never stdout', () => {
    engineLog.setLevel('debug')
    bus.publish({ type: 'status', executionId: 'ex-1', nodeId: 'n-1', data: 'running' })
    bus.publish({ type: 'stdout', executionId: 'ex-1', nodeId: 'n-1', data: 'secret tool output' })
    bus.publish({ type: 'done', executionId: 'ex-1', nodeId: 'n-1', data: 'succeeded' })
    const lines = nodeLines()
    expect(lines.map((l) => [l.msg, l.data?.status])).toEqual([
      ['Node status', 'running'],
      ['Node finished', 'succeeded'],
    ])
    expect(lines[0]).toMatchObject({ lvl: 'debug', data: { execution: 'ex-1', node: 'n-1' } })
    expect(JSON.stringify(lines)).not.toContain('tool output')
  })

  it('logs nothing at info', () => {
    bus.publish({ type: 'status', executionId: 'ex-1', nodeId: 'n-1', data: 'running' })
    expect(nodeLines()).toHaveLength(0)
  })
})
