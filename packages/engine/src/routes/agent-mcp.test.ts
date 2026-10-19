import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentMcpRoutes } from './agent-mcp.js'

const suiteHome = process.env.EXECUTIONER_HOME

beforeEach(() => {
  process.env.EXECUTIONER_HOME = mkdtempSync(join(tmpdir(), 'exe-mcproute-'))
})

afterAll(() => {
  if (suiteHome === undefined) delete process.env.EXECUTIONER_HOME
  else process.env.EXECUTIONER_HOME = suiteHome
})

describe('agent-mcp routes', () => {
  it('serves the default (all-on) wiring config', async () => {
    const app = agentMcpRoutes()
    const res = await app.request('/agent-mcp/config')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: {} })
  })

  it('persists a PUT and reflects it on the next GET', async () => {
    const app = agentMcpRoutes()
    const put = await app.request('/agent-mcp/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: { opencode: false, junk: 'x' } }),
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ enabled: { opencode: false } })

    const get = await app.request('/agent-mcp/config')
    expect(await get.json()).toEqual({ enabled: { opencode: false } })
  })

  it('rejects a non-object body', async () => {
    const app = agentMcpRoutes()
    const res = await app.request('/agent-mcp/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('nope'),
    })
    expect(res.status).toBe(400)
  })

  it('lists the injectable agents', async () => {
    const app = agentMcpRoutes()
    const res = await app.request('/agent-mcp/injectable')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ agents: ['opencode'] })
  })
})
