import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'

const TOKEN = 'a'.repeat(40)
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-screenshotroutes-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const auth = { headers: { authorization: `Bearer ${TOKEN}` } }

/** Narrow an indexed lookup to a present value, failing loudly if it is missing. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value, got undefined')
  return v
}

describe('target screenshot routes', () => {
  it('returns 404 for an unknown target id', async () => {
    const res = await app.request('/api/targets/does-not-exist/screenshots', auth)
    expect(res.status).toBe(404)
  })

  it('serves a screenshot fact as a base64 data url', async () => {
    const t = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const shotPath = join(root, 'shot.png')
    writeFileSync(shotPath, Buffer.from('89504e470d0a1a0a0000', 'hex'))
    project.facts.record({
      targetId: t.id,
      kind: 'screenshot',
      executionId: null,
      nodeId: 'n1',
      data: { path: shotPath, url: 'https://example.com' },
    })

    const res = await app.request(`/api/targets/${t.id}/screenshots`, auth)
    expect(res.status).toBe(200)
    const items = (await res.json()) as Array<{ dataUrl: string; url?: string; factId: string }>
    expect(items.length).toBe(1)
    const first = must(items[0])
    expect(first.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(first.url).toBe('https://example.com')
    expect(first.factId).toBeTruthy()
  })

  it('never reads a file outside the engagement, whatever path a fact names', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'exe-outside-'))
    try {
      const secret = join(outside, 'id_rsa.png')
      writeFileSync(secret, 'private key material')
      const t = project.targets.upsert({ kind: 'domain', value: 'exfil.com', source: 'manual' })
      for (const path of [secret, `${root}/../${outside.split('/').pop() ?? ''}/id_rsa.png`, 'relative.png']) {
        project.facts.record({ targetId: t.id, kind: 'screenshot', executionId: null, nodeId: path, data: { path } })
      }

      const res = await app.request(`/api/targets/${t.id}/screenshots`, auth)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('silently skips a screenshot fact whose file is missing', async () => {
    const t = project.targets.upsert({ kind: 'domain', value: 'gone.com', source: 'manual' })
    project.facts.record({
      targetId: t.id,
      kind: 'screenshot',
      executionId: null,
      nodeId: 'n1',
      data: { path: join(root, 'nope', 'missing.png') },
    })

    const res = await app.request(`/api/targets/${t.id}/screenshots`, auth)
    expect(res.status).toBe(200)
    const items = (await res.json()) as unknown[]
    expect(items.length).toBe(0)
  })
})
