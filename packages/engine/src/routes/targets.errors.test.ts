import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createProject, type Project } from '@exe/project'
import { targetRoutes } from './targets.js'

let root: string
let project: Project
let app: Hono

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-target-errors-'))
  project = createProject(root, { name: 'bmw' })
  app = new Hono().route('/', targetRoutes(project))
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

const post = async (body: unknown): Promise<Response> =>
  app.request('/targets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /targets — a value the tree cannot store', () => {
  it('answers 400 for a wildcard rather than failing with a 500', () => {
    // Typing *.bmw.com into "add target" used to reach an uncaught throw, so the
    // operator saw "Request failed with status code 500" and no reason.
    return post({ kind: 'domain', value: '*.bmw.com' }).then(async (res) => {
      expect(res.status).toBe(400)
    })
  })

  it('says what to do with the wildcard instead', async () => {
    const res = await post({ kind: 'domain', value: '*.bmw.com' })
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/wildcard/i)
    expect(body.error).toMatch(/scope rule/i)
  })

  it('answers 400 for a malformed address', async () => {
    const res = await post({ kind: 'ip', value: '999.1.1.1' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/ip address/i)
  })

  it('answers 400 for a url with no scheme', async () => {
    const res = await post({ kind: 'url', value: 'bmw.com/path' })
    expect(res.status).toBe(400)
  })

  it('stores nothing when it refuses', async () => {
    await post({ kind: 'domain', value: '*.bmw.com' })
    expect(project.targets.all()).toHaveLength(0)
  })

  it('still creates a target that is fine', async () => {
    const res = await post({ kind: 'domain', value: 'bmw.com' })
    expect(res.status).toBe(201)
  })
})

describe('PATCH /targets/:id — telling a bad value from a collision', () => {
  const patch = async (id: string, body: unknown): Promise<Response> =>
    app.request(`/targets/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('answers 400 when renaming to something unstorable', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'bmw.com', source: 'manual' })
    const res = await patch(target.id, { value: '*.bmw.com' })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/wildcard/i)
  })

  it('still answers 409 when the rename collides with an existing target', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'bmw.com', source: 'manual' })
    project.targets.upsert({ kind: 'domain', value: 'bmwgroup.com', source: 'manual' })

    const res = await patch(target.id, { value: 'bmwgroup.com' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/already exists/i)
  })
})
