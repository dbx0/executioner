import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { ProjectToolset } from './toolset.js'
import { mcpRoute } from './route.js'

async function readJson<T>(res: { json(): Promise<unknown> }): Promise<T> {
  return (await res.json()) as T
}

const TOKEN = 'mcp-token-mcp-token-mcp-token-tok'
let dir: string
let project: Project
let app: ReturnType<typeof mcpRoute>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-mcproute-'))
  project = createProject(dir, { name: 'test' })
  app = mcpRoute(new ProjectToolset({ project, runWorkflow: vi.fn() }), TOKEN)
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('mcpRoute', () => {
  it('rejects a request with no token', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    expect(res.status).toBe(401)
  })

  it('answers tools/list for an authorised request', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    })
    expect(res.status).toBe(200)
    const body = await readJson<{ result: { tools: unknown[] } }>(res)
    expect(body.result.tools.length).toBeGreaterThan(0)
  })
})
