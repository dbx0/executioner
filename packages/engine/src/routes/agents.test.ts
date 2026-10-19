import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { bearerAuth } from '../transport/auth.js'
import { agentRoutes, type AgentProbe, type AgentStatus } from './agents.js'

const TOKEN = 'a'.repeat(40)
const auth = { authorization: `Bearer ${TOKEN}` }

/** Mount agentRoutes under the same bearer guard the real server uses. */
function makeApp(probe: AgentProbe): Hono {
  const app = new Hono()
  const api = new Hono()
  api.use('*', bearerAuth(TOKEN))
  api.route('/', agentRoutes({ probe }))
  app.route('/api', api)
  return app
}

/** A stubbed probe keyed by binary, so no real process is ever spawned. */
function stub(map: Record<string, { installed: boolean; version: string | null; error: string | null }>): AgentProbe {
  return (binary) =>
    Promise.resolve(map[binary] ?? { installed: false, version: null, error: 'binary not on PATH' })
}

describe('agent routes', () => {
  it('guards the routes behind the bearer token', async () => {
    const res = await makeApp(stub({})).request('/api/agents')
    expect(res.status).toBe(401)
  })

  it('reports installed+version, installed+no-version, and not-installed', async () => {
    const app = makeApp(
      stub({
        claude: { installed: true, version: 'claude 2.1.260', error: null },
        'cursor-agent': { installed: true, version: null, error: null },
        // everything else falls through the stub default → not installed
      }),
    )
    const res = await app.request('/api/agents', { headers: auth })
    expect(res.status).toBe(200)
    const rows = (await res.json()) as AgentStatus[]

    const claude = rows.find((r) => r.id === 'claude')
    expect(claude).toMatchObject({ installed: true, version: 'claude 2.1.260', error: null, binary: 'claude' })

    const cursor = rows.find((r) => r.id === 'cursor')
    expect(cursor).toMatchObject({ installed: true, version: null, error: null, binary: 'cursor-agent' })

    const gemini = rows.find((r) => r.id === 'gemini')
    expect(gemini).toMatchObject({ installed: false, version: null })
    expect(gemini?.error).toBe('binary not on PATH')

    // claude-team must never appear — it is not a separate CLI.
    expect(rows.some((r) => r.id === 'claude-team')).toBe(false)
  })

  it('re-checks a single agent via GET /agents/:id', async () => {
    const app = makeApp(stub({ codex: { installed: true, version: 'codex 0.9.1', error: null } }))
    const res = await app.request('/api/agents/codex', { headers: auth })
    expect(res.status).toBe(200)
    expect((await res.json()) as AgentStatus).toMatchObject({
      id: 'codex',
      installed: true,
      version: 'codex 0.9.1',
    })
  })

  it('404s an unknown agent id', async () => {
    const res = await makeApp(stub({})).request('/api/agents/nope', { headers: auth })
    expect(res.status).toBe(404)
  })
})
