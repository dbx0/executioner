import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'
import { BUILTIN_TEAMS } from '../agents/agent-team.js'

const TOKEN = 'a'.repeat(40)
const auth = { headers: { authorization: `Bearer ${TOKEN}` } }
let root: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-teamroutes-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

describe('GET /api/teams', () => {
  it('401s without the bearer token', async () => {
    const res = await app.request('/api/teams')
    expect(res.status).toBe(401)
  })

  it('lists every built-in team as a prompt-free summary', async () => {
    const res = await app.request('/api/teams', auth)
    expect(res.status).toBe(200)
    const teams = (await res.json()) as { id: string; members: { name: string }[] }[]
    expect(teams).toHaveLength(BUILTIN_TEAMS.length)
    const reconStrike = teams.find((t) => t.id === 'recon-strike')!
    expect(reconStrike.members.map((m) => m.name)).toEqual(['recon', 'scanner', 'exploit', 'reporter'])
    // Prompts are never shipped to the UI.
    expect(JSON.stringify(teams)).not.toContain('You are a reconnaissance specialist')
  })
})

describe('GET /api/teams/:id', () => {
  it('returns one team summary', async () => {
    const res = await app.request('/api/teams/web-appsec', auth)
    expect(res.status).toBe(200)
    const team = (await res.json()) as { id: string; members: { name: string; model: string }[] }
    expect(team.id).toBe('web-appsec')
    expect(team.members.find((m) => m.name === 'injection')!.model).toBe('opus')
  })

  it('404s for an unknown team', async () => {
    const res = await app.request('/api/teams/nope', auth)
    expect(res.status).toBe(404)
  })
})
