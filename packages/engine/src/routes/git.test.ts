import { execFileSync } from 'node:child_process'
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
  root = mkdtempSync(join(tmpdir(), 'exe-gitroutes-'))
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

describe('git routes', () => {
  it('degrades to isRepo:false when the root is not a git repo', async () => {
    const res = await app.request('/api/git/status', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { isRepo: boolean; branch: string | null; files: unknown[] }
    expect(body.isRepo).toBe(false)
    expect(body.branch).toBeNull()
    expect(body.files).toEqual([])
  })

  it('reports status and log for a real repo', async () => {
    let initialised = true
    try {
      execFileSync('git', ['init'], { cwd: root })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root })
      writeFileSync(join(root, 'file.txt'), 'content')
      execFileSync('git', ['add', 'file.txt'], { cwd: root })
      execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: root })
    } catch {
      initialised = false
    }

    if (!initialised) {
      // git unavailable: at least confirm the not-a-repo path holds.
      const res = await app.request('/api/git/status', { headers: auth })
      const body = (await res.json()) as { isRepo: boolean }
      expect(body.isRepo).toBe(false)
      return
    }

    const statusRes = await app.request('/api/git/status', { headers: auth })
    expect(statusRes.status).toBe(200)
    const status = (await statusRes.json()) as { isRepo: boolean; branch: string | null }
    expect(status.isRepo).toBe(true)
    expect(status.branch).not.toBeNull()

    const logRes = await app.request('/api/git/log', { headers: auth })
    expect(logRes.status).toBe(200)
    const log = (await logRes.json()) as {
      isRepo: boolean
      commits: Array<{ subject: string }>
    }
    expect(log.commits.length).toBeGreaterThanOrEqual(1)
    expect(log.commits[0]?.subject).toBe('initial commit')
  })

  it('guards the routes behind the bearer token', async () => {
    const res = await app.request('/api/git/status')
    expect(res.status).toBe(401)
  })
})
