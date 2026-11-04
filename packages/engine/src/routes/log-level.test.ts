import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'
import { engineLog } from '../infra/log.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeSync: vi.fn() }
})

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-loglevel-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor: new Executor(project, new EventBus()) })
  engineLog.setLevel('info')
  engineLog.setMasks([])
})
afterEach(() => {
  engineLog.setLevel('info')
  engineLog.setMasks([])
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { authorization: `Bearer ${TOKEN}` }
const put = (path: string, body: unknown, headers: Record<string, string> = auth): Promise<Response> =>
  Promise.resolve(
    app.request(path, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  )

describe('log-level route', () => {
  it('sets the engine log level', async () => {
    const res = await put('/api/log-level', { level: 'debug' })
    expect(res.status).toBe(204)
    expect(engineLog.level()).toBe('debug')
  })

  it('rejects an unknown level', async () => {
    const res = await put('/api/log-level', { level: 'loud' })
    expect(res.status).toBe(400)
    expect(engineLog.level()).toBe('info')
  })

  it('requires the bearer token', async () => {
    const res = await put('/api/log-level', { level: 'debug' }, {})
    expect(res.status).toBe(401)
  })

  it('masks a secret written through the secrets route', async () => {
    const res = await put('/api/secrets/CENSYS_API_TOKEN', { value: 'fresh-secret-value' })
    expect(res.status).toBe(200)
    vi.mocked(fs.writeSync).mockClear()
    engineLog.info('t', 'saw fresh-secret-value')
    expect(fs.writeSync).toHaveBeenCalledTimes(1)
    const text = String(vi.mocked(fs.writeSync).mock.calls[0]?.[1])
    expect(text).not.toContain('fresh-secret-value')
    expect(text).toContain('[secret]')
  })

  it("masks the engine's own bearer token once the app is created", () => {
    vi.mocked(fs.writeSync).mockClear()
    engineLog.info('t', `leaked ${TOKEN}`)
    const text = String(vi.mocked(fs.writeSync).mock.calls[0]?.[1])
    expect(text).not.toContain(TOKEN)
    expect(text).toContain('[secret]')
  })
})
