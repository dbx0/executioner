import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
let skillsFolder: string
let project: Project
let app: ReturnType<typeof createApp>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-skillroutes-'))
  skillsFolder = mkdtempSync(join(tmpdir(), 'exe-skillfolder-'))
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  const executor = new Executor(project, new EventBus())
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(skillsFolder, { recursive: true, force: true })
})

const auth = { authorization: `Bearer ${TOKEN}` }
const putJson = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function writeSkill(name: string, frontmatter: string): void {
  const dir = join(skillsFolder, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), frontmatter)
}

describe('skill routes', () => {
  it('guards behind the bearer token', async () => {
    expect((await app.request('/api/skills/config')).status).toBe(401)
  })

  it('defaults the config, then round-trips a PUT', async () => {
    const initial = await (await app.request('/api/skills/config', { headers: auth })).json()
    expect(initial).toEqual({ folder: null, enabled: {} })

    const put = await app.request('/api/skills/config', putJson({ folder: skillsFolder, enabled: { claude: true } }))
    expect(put.status).toBe(200)

    const after = await (await app.request('/api/skills/config', { headers: auth })).json()
    expect(after).toEqual({ folder: skillsFolder, enabled: { claude: true } })
  })

  it('rejects a non-string folder', async () => {
    const res = await app.request('/api/skills/config', putJson({ folder: 123 }))
    expect(res.status).toBe(400)
  })

  it('discovers skills in the configured folder', async () => {
    writeSkill('foo', '---\nname: foo\ndescription: Use when foo.\n---\n')
    writeSkill('bar', '---\nname: bar\ndescription: Use when bar.\n---\n')
    await app.request('/api/skills/config', putJson({ folder: skillsFolder, enabled: {} }))

    const skills = (await (await app.request('/api/skills', { headers: auth })).json()) as Array<{
      name: string
      description: string
      path: string
    }>
    expect(skills.map((s) => s.name).sort()).toEqual(['bar', 'foo'])
  })

  it('discovers skills via a ?folder override', async () => {
    writeSkill('baz', '---\nname: baz\ndescription: Baz.\n---\n')
    const skills = (await (
      await app.request(`/api/skills?folder=${encodeURIComponent(skillsFolder)}`, { headers: auth })
    ).json()) as unknown[]
    expect(skills).toHaveLength(1)
  })

  it('generates AGENTS.md from the discovered skills', async () => {
    writeSkill('foo', '---\nname: foo\ndescription: Use when foo.\n---\n')
    await app.request('/api/skills/config', putJson({ folder: skillsFolder, enabled: {} }))

    const res = await app.request('/api/skills/agents-md', { method: 'POST', headers: auth })
    const body = (await res.json()) as { ok: boolean; path: string; count: number }
    expect(body.ok).toBe(true)
    expect(body.count).toBe(1)
    const md = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    expect(md).toContain('## foo')
    expect(md).toContain('<!-- executioner:skills:start -->')
  })
})
