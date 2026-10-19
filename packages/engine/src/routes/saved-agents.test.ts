import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import type { SavedAgent } from '@exe/db'
import { SavedAgentsStore } from '../agents/saved-agents-store.js'
import { savedAgentRoutes } from './saved-agents.js'

let root: string
let home: string
let project: Project
let app: Hono

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-savedagents-'))
  home = mkdtempSync(join(tmpdir(), 'exe-home-'))
  project = createProject(root, { name: 'acme' })
  const store = new SavedAgentsStore({ home })
  app = new Hono()
  app.route('/', savedAgentRoutes(project, store))
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('saved-agent routes', () => {
  it('lists the seeded global agents merged with local ones', async () => {
    project.savedAgents.create({ name: 'LocalOne', agent: 'claude', prompt: 'p' })
    const res = await app.request('/saved-agents')
    const { agents } = (await res.json()) as { agents: SavedAgent[] }
    expect(agents.some((a) => a.name === 'LocalOne' && a.scope === 'local')).toBe(true)
    expect(agents.some((a) => a.scope === 'global')).toBe(true)
  })

  it('rejects a body missing required fields', async () => {
    const res = await app.request('/saved-agents', json({ name: '', agent: 'claude', prompt: 'p', scope: 'local' }))
    expect(res.status).toBe(400)
  })

  it('creates a local agent in the DB', async () => {
    const res = await app.request(
      '/saved-agents',
      json({ name: 'DBAgent', agent: 'codex', prompt: 'go', scope: 'local' }),
    )
    expect(res.status).toBe(201)
    const created = (await res.json()) as SavedAgent
    expect(created.scope).toBe('local')
    expect(project.savedAgents.get(created.id)?.name).toBe('DBAgent')
  })

  it('creates a global agent in the file', async () => {
    const res = await app.request(
      '/saved-agents',
      json({ name: 'FileAgent', agent: 'claude', prompt: 'go', scope: 'global' }),
    )
    const created = (await res.json()) as SavedAgent
    expect(created.scope).toBe('global')
    // Not in the DB.
    expect(project.savedAgents.get(created.id)).toBeUndefined()
  })

  it('moves an agent from local to global on a scope change', async () => {
    const local = project.savedAgents.create({ name: 'Mover', agent: 'claude', prompt: 'p' })
    const res = await app.request(`/saved-agents/${local.id}`, {
      ...json({ name: 'Mover', agent: 'claude', prompt: 'p', scope: 'global' }),
      method: 'PUT',
    })
    expect(res.status).toBe(200)
    const moved = (await res.json()) as SavedAgent
    expect(moved.scope).toBe('global')
    // Gone from the DB, present in the file.
    expect(project.savedAgents.get(local.id)).toBeUndefined()
    const list = await (await app.request('/saved-agents')).json() as { agents: SavedAgent[] }
    expect(list.agents.some((a) => a.name === 'Mover' && a.scope === 'global')).toBe(true)
  })

  it('updates a global agent in place without moving it', async () => {
    const created = (await (
      await app.request('/saved-agents', json({ name: 'G', agent: 'claude', prompt: 'p', scope: 'global' }))
    ).json()) as SavedAgent
    const res = await app.request(`/saved-agents/${created.id}`, {
      ...json({ name: 'G2', agent: 'claude', prompt: 'p2', scope: 'global' }),
      method: 'PUT',
    })
    const updated = (await res.json()) as SavedAgent
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('G2')
    expect(updated.scope).toBe('global')
  })

  it('deletes a local agent', async () => {
    const local = project.savedAgents.create({ name: 'Del', agent: 'claude', prompt: 'p' })
    const res = await app.request(`/saved-agents/${local.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(project.savedAgents.get(local.id)).toBeUndefined()
  })

  it('deletes a global agent', async () => {
    const store = new SavedAgentsStore({ home })
    const g = store.create({ name: 'GDel', agent: 'claude', prompt: 'p' })
    const res = await app.request(`/saved-agents/${g.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(new SavedAgentsStore({ home }).get(g.id)).toBeUndefined()
  })
})
