import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventBus } from '../transport/events.js'
import { bearerAuth } from '../transport/auth.js'
import { logsRoutes } from './logs.js'

const TOKEN = 'a'.repeat(40)
const auth = { authorization: `Bearer ${TOKEN}` }

/** Mount the logs routes behind the same bearer guard the real /api uses. */
function mount(opts: Parameters<typeof logsRoutes>[0]): Hono {
  const app = new Hono()
  const api = new Hono()
  api.use('*', bearerAuth(TOKEN))
  api.route('/', logsRoutes(opts))
  app.route('/api', api)
  return app
}

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'exe-logs-'))
  delete process.env.EXE_ENGINE_LOG_FILE
})
afterEach(() => {
  delete process.env.EXE_ENGINE_LOG_FILE
  rmSync(tmp, { recursive: true, force: true })
})

describe('logs route', () => {
  it('guards the route behind the bearer token', async () => {
    const app = mount({ bus: new EventBus() })
    const res = await app.request('/api/logs')
    expect(res.status).toBe(401)
  })

  it('returns an empty state when nothing has been logged', async () => {
    const app = mount({ bus: new EventBus() })
    const res = await app.request('/api/logs', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { source: string; lines: string[] }
    expect(body.source).toBe('empty')
    expect(body.lines).toEqual([])
  })

  it('serves recent engine events from the in-memory buffer', async () => {
    const bus = new EventBus()
    const app = mount({ bus })
    bus.publish({ type: 'stdout', executionId: 'exec1', nodeId: 'httpx', data: 'scanning' })
    bus.publish({ type: 'status', executionId: 'exec1', nodeId: '', data: 'done' })
    const res = await app.request('/api/logs', { headers: auth })
    const body = (await res.json()) as { source: string; lines: string[] }
    expect(body.source).toBe('events')
    expect(body.lines).toHaveLength(2)
    expect(body.lines[0]).toContain('[stdout]')
    expect(body.lines[0]).toContain('exec1/httpx')
    expect(body.lines[0]).toContain('scanning')
  })

  it('honours ?limit by returning only the most recent lines', async () => {
    const bus = new EventBus()
    const app = mount({ bus })
    for (let i = 0; i < 10; i += 1) {
      bus.publish({ type: 'stdout', executionId: 'e', nodeId: 'n', data: `line-${i}` })
    }
    const res = await app.request('/api/logs?limit=3', { headers: auth })
    const body = (await res.json()) as { lines: string[] }
    expect(body.lines).toHaveLength(3)
    expect(body.lines[2]).toContain('line-9')
  })

  it('caps the ring buffer at its configured size', async () => {
    const bus = new EventBus()
    const app = mount({ bus, bufferSize: 5 })
    for (let i = 0; i < 20; i += 1) {
      bus.publish({ type: 'stdout', executionId: 'e', nodeId: 'n', data: `line-${i}` })
    }
    const res = await app.request('/api/logs?limit=1000', { headers: auth })
    const body = (await res.json()) as { lines: string[] }
    expect(body.lines).toHaveLength(5)
    expect(body.lines[0]).toContain('line-15')
  })

  it('tails a configured log file when one exists, path-guarded', async () => {
    const file = join(tmp, 'engine.log')
    writeFileSync(file, 'boot\nlistening on 4000\nready\n')
    const app = mount({ bus: new EventBus(), logFile: file })
    const res = await app.request('/api/logs', { headers: auth })
    const body = (await res.json()) as { source: string; lines: string[] }
    expect(body.source).toBe('file')
    expect(body.lines).toEqual(['boot', 'listening on 4000', 'ready'])
  })

  it('ignores a non-absolute or missing log file and falls back to events', async () => {
    const bus = new EventBus()
    const app = mount({ bus, logFile: 'relative/engine.log' })
    bus.publish({ type: 'stderr', executionId: 'e', nodeId: 'n', data: 'oops' })
    const res = await app.request('/api/logs', { headers: auth })
    const body = (await res.json()) as { source: string }
    expect(body.source).toBe('events')
  })
})
