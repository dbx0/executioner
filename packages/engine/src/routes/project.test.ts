import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createProject, readConfig, type Project } from '@exe/project'
import { projectRoutes } from './project.js'

let root: string
let project: Project
let app: Hono

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-projectroute-'))
  project = createProject(root, { name: 'acme' })
  app = new Hono().route('/', projectRoutes(project))
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

describe('GET /project', () => {
  it('returns the name and a null icon by default', async () => {
    const res = await app.request('/project')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ root, name: 'acme', icon: null, defaultBackendProfileId: null })
  })
})

describe('PATCH /project default backend', () => {
  it('sets the engagement default backend profile id, live and on disk', async () => {
    const kali = project.backends.create({ name: 'kali', kind: 'ssh', host: 'kali.lan', user: 'root' })
    const res = await app.request('/project', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultBackendProfileId: kali.id }),
    })
    expect(res.status).toBe(200)
    expect(readConfig(root).defaultBackendProfileId).toBe(kali.id)
    // Read live by MCP/scheduled runs in this same session, so no restart needed.
    expect(project.config.defaultBackendProfileId).toBe(kali.id)
  })

  it('rejects a default backend that names no saved profile', async () => {
    const res = await app.request('/project', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultBackendProfileId: 'ghost' }),
    })
    expect(res.status).toBe(400)
  })

  it('clears the default backend when passed an empty string', async () => {
    const kali = project.backends.create({ name: 'kali', kind: 'ssh', host: 'kali.lan', user: 'root' })
    await app.request('/project', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultBackendProfileId: kali.id }),
    })
    await app.request('/project', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultBackendProfileId: '' }),
    })
    expect(readConfig(root).defaultBackendProfileId).toBeUndefined()
    expect(project.config.defaultBackendProfileId).toBeUndefined()
  })
})

describe('PATCH /project', () => {
  it('sets the name and icon and persists them', async () => {
    const res = await app.request('/project', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed', icon: '🎯' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ root, name: 'renamed', icon: '🎯', defaultBackendProfileId: null })
    expect(readConfig(root).name).toBe('renamed')
    expect(readConfig(root).icon).toBe('🎯')
  })

  it('clears the icon when passed an empty string', async () => {
    await app.request('/project', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: '🎯' }),
    })
    const res = await app.request('/project', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: '' }),
    })
    expect((await res.json() as { icon: string | null }).icon).toBeNull()
    expect(readConfig(root).icon).toBeUndefined()
  })
})
