import { mkdtempSync, rmSync } from 'node:fs'
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
  root = mkdtempSync(join(tmpdir(), 'exe-secretroutes-'))
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
const putJson = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('secret routes', () => {
  it('rejects a PUT with a non-string value', async () => {
    const res = await app.request('/api/secrets/SHODAN_API_KEY', putJson({ value: 123 }))
    expect(res.status).toBe(400)
  })

  it('sets, lists and deletes a secret', async () => {
    const set = await app.request('/api/secrets/SHODAN_API_KEY', putJson({ value: 'abc' }))
    expect(set.status).toBe(200)

    const listed = await app.request('/api/secrets', { headers: auth })
    const rows = (await listed.json()) as Array<{ key: string; value: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('SHODAN_API_KEY')
    expect(rows[0]?.value).toBe('abc')

    const del = await app.request('/api/secrets/SHODAN_API_KEY', { method: 'DELETE', headers: auth })
    expect(del.status).toBe(200)
    const after = await app.request('/api/secrets', { headers: auth })
    expect(((await after.json()) as unknown[]).length).toBe(0)
  })

  it('guards the routes behind the bearer token', async () => {
    const res = await app.request('/api/secrets')
    expect(res.status).toBe(401)
  })
})
