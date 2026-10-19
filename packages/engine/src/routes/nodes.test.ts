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
  root = mkdtempSync(join(tmpdir(), 'exe-routes-'))
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

describe('GET /api/nodes', () => {
  it('lists the bundled registry', async () => {
    const res = await app.request('/api/nodes', auth)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((n) => n.id).sort()).toEqual([
      'amass',
      'dalfox',
      'dig',
      'dnsx',
      'enum4linux',
      'feroxbuster',
      'ffuf',
      'gau',
      'gobuster',
      'gowitness',
      'httpx',
      'hydra',
      'katana',
      'masscan',
      'mtr',
      'naabu',
      'nbtscan',
      'netexec',
      'nikto',
      'nmap',
      'nuclei',
      'rustscan',
      'searchsploit',
      'sqlmap',
      'sslscan',
      'subfinder',
      'testssl',
      'theharvester',
      'traceroute',
      'wafw00f',
      'whatweb',
      'whois',
      'wpscan',
    ])
  })
})

describe('POST /api/executions', () => {
  it('404s an unknown node', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const res = await app.request('/api/executions', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'nope', targetId: target.id }),
    })
    expect(res.status).toBe(404)
  })

  it('404s an unknown target', async () => {
    const res = await app.request('/api/executions', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'subfinder', targetId: 'missing' }),
    })
    expect(res.status).toBe(404)
  })

  it('400s a target whose kind the node does not accept', async () => {
    const ip = project.targets.upsert({ kind: 'ip', value: '10.0.0.1', source: 'manual' })
    const res = await app.request('/api/executions', {
      method: 'POST',
      headers: { ...auth.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'subfinder', targetId: ip.id }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/executions/:id', () => {
  it('404s an unknown execution', async () => {
    const res = await app.request('/api/executions/nope', auth)
    expect(res.status).toBe(404)
  })
})
