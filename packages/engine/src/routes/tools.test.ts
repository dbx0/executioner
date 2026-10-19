import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { BackendProfile, ToolManifest } from '@exe/protocol'
import { bearerAuth } from '../transport/auth.js'
import { toolRoutes } from './tools.js'
import type { AgentProbe } from './agents.js'
import type { ToolProbeBatchResponse, ToolsResponse } from './tools.js'
import type { RunOutcome, RunFn } from '../infra/backend-test.js'

const TOKEN = 'a'.repeat(40)
const auth = { authorization: `Bearer ${TOKEN}` }

/** A minimal manifest with just the fields the tools route reads. */
function manifest(id: string, name: string, program: string): ToolManifest {
  return {
    id,
    name,
    description: `${name} tool`,
    category: 'recon',
    accepts: ['domain'],
    params: {},
    command: { program, args: [], timeout_ms: 120000 },
    emit: { parser: 'json', source: 'stdout', records: '$', targets: [], facts: [] },
  } as ToolManifest
}

/** Extra wiring a test needs only when it exercises the remote batch probe. */
interface Remote {
  backends?: BackendProfile[]
  run?: RunFn
}

/** Mount toolRoutes under the same bearer guard the real server uses. */
function makeApp(manifests: ToolManifest[], probe: AgentProbe, remote: Remote = {}): Hono {
  const app = new Hono()
  const api = new Hono()
  api.use('*', bearerAuth(TOKEN))
  api.route(
    '/',
    toolRoutes({
      manifests: () => manifests,
      probe,
      backends: () => remote.backends ?? [],
      ...(remote.run !== undefined ? { run: remote.run } : {}),
    }),
  )
  app.route('/api', api)
  return app
}

const SSH_BACKEND: BackendProfile = {
  id: 'be-1',
  name: 'kali',
  kind: 'ssh',
  host: 'kali.lan',
  user: 'root',
  createdAt: '',
  updatedAt: '',
}

/** A runner returning a canned outcome, recording how many times it was spawned. */
function runner(outcome: Partial<RunOutcome>): { run: RunFn; count: () => number } {
  let count = 0
  const run: RunFn = async () => {
    count += 1
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...outcome }
  }
  return { run, count: () => count }
}

/** The stdout the remote probe script produces for the given rows. */
function remoteStdout(rows: [string, string, string][]): string {
  return ['EXE_PROBE_BEGIN', ...rows.map((r) => r.join('\t'))].join('\n') + '\n'
}

/** POST /tools/probe-batch with the bearer token. */
async function postBatch(app: Hono, body: unknown): Promise<Response> {
  return await app.request('/api/tools/probe-batch', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A stubbed probe keyed by program, so no real process is ever spawned. */
function stub(map: Record<string, { installed: boolean; version: string | null }>): AgentProbe {
  return (program) =>
    Promise.resolve({ ...(map[program] ?? { installed: false, version: null }), error: null })
}

describe('tool routes', () => {
  it('guards the route behind the bearer token', async () => {
    const res = await makeApp([], stub({})).request('/api/tools')
    expect(res.status).toBe(401)
  })

  it('returns the catalog (alpha-sorted, no probing), dedupes shared programs, and carries install hints', async () => {
    const manifests = [
      manifest('nmap', 'Nmap', 'nmap'),
      manifest('whois', 'Whois', 'whois'),
      // Two manifests that share one program → one deduped tool row.
      manifest('httpx', 'httpx', 'httpx'),
      manifest('httpx-alt', 'HTTPX Probe', 'httpx'),
    ]
    const app = makeApp(manifests, stub({}))
    const res = await app.request('/api/tools', { headers: auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ToolsResponse

    expect(body.platform).toBe(process.platform)
    // Three distinct programs (httpx deduped), alphabetical.
    expect(body.tools.map((t) => t.program)).toEqual(['httpx', 'nmap', 'whois'])
    // Catalog has no probe fields.
    expect(body.tools[0]).not.toHaveProperty('installed')

    const whois = body.tools.find((t) => t.program === 'whois')!
    expect(whois.install.darwin).toBe('brew install whois')

    // Deduped program lists every node name that uses it.
    const httpx = body.tools.find((t) => t.program === 'httpx')!
    expect(httpx.usedBy).toEqual(['httpx', 'HTTPX Probe'])
  })

  it('probes one tool via /tools/probe', async () => {
    const app = makeApp([manifest('nmap', 'Nmap', 'nmap')], stub({ nmap: { installed: true, version: 'nmap 7.94' } }))
    const ok = await app.request('/api/tools/probe?program=nmap', { headers: auth })
    expect(await ok.json()).toEqual({ program: 'nmap', installed: true, version: 'nmap 7.94' })
    const missing = await app.request('/api/tools/probe?program=whois', { headers: auth })
    expect(await missing.json()).toEqual({ program: 'whois', installed: false, version: null })
    const bad = await app.request('/api/tools/probe', { headers: auth })
    expect(bad.status).toBe(400)
  })

  it('only probes bare program names, never a path or an option', async () => {
    const seen: string[] = []
    const app = makeApp([], (program) => {
      seen.push(program)
      return Promise.resolve({ installed: false, version: null, error: null })
    })
    for (const program of ['/tmp/x', './x', '../bin/sh', '-rf', 'a b']) {
      const res = await app.request(`/api/tools/probe?program=${encodeURIComponent(program)}`, { headers: auth })
      expect(res.status).toBe(400)
    }
    const batch = await app.request('/api/tools/probe-batch', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ programs: ['/tmp/x', 'nmap'] }),
    })
    expect(batch.status).toBe(200)
    expect(seen).toEqual(['nmap'])
  })

  it('falls back to a generic hint for an unknown program', async () => {
    const app = makeApp([manifest('custom', 'Custom Tool', 'mytool')], stub({}))
    const res = await app.request('/api/tools', { headers: auth })
    const body = (await res.json()) as ToolsResponse
    const tool = body.tools[0]!
    expect(tool.program).toBe('mytool')
    expect(tool.install).toEqual({ note: 'Install mytool and ensure it is on your PATH.' })
  })

  describe('probe-batch', () => {
    it('probes many programs on the engine host in one request', async () => {
      const app = makeApp([], stub({ nmap: { installed: true, version: 'nmap 7.94' }, whois: { installed: false, version: null } }))
      const res = await postBatch(app, { programs: ['nmap', 'whois'] })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        backendId: 'local',
        results: [
          { program: 'nmap', installed: true, version: 'nmap 7.94' },
          { program: 'whois', installed: false, version: null },
        ],
      })
    })

    it('rejects a request with no programs', async () => {
      const res = await postBatch(makeApp([], stub({})), { programs: [] })
      expect(res.status).toBe(400)
    })

    it('404s an unknown backend rather than silently probing this machine', async () => {
      const res = await postBatch(makeApp([], stub({})), { backendId: 'nope', programs: ['nmap'] })
      expect(res.status).toBe(404)
    })

    it('probes a saved connection with ONE spawn, not one per tool', async () => {
      const { run, count } = runner({
        stdout: remoteStdout([
          ['nmap', '/usr/bin/nmap', 'Nmap version 7.94'],
          ['whois', '', ''],
          ['amass', '/root/go/bin/amass', 'v4.2.0'],
        ]),
      })
      const app = makeApp([], stub({}), { backends: [SSH_BACKEND], run })
      const res = await postBatch(app, { backendId: 'be-1', programs: ['nmap', 'whois', 'amass'] })

      expect(count()).toBe(1)
      expect(await res.json()).toEqual({
        backendId: 'be-1',
        results: [
          { program: 'nmap', installed: true, version: 'nmap 7.94' },
          { program: 'whois', installed: false, version: null },
          { program: 'amass', installed: true, version: 'amass 4.2.0' },
        ],
      })
    })

    it('reports an unreachable connection as an error with no results', async () => {
      const { run } = runner({ code: 255, stderr: 'ssh: connect to host kali.lan port 22: No route to host' })
      const app = makeApp([], stub({}), { backends: [SSH_BACKEND], run })
      const body = (await (await postBatch(app, { backendId: 'be-1', programs: ['nmap'] })).json()) as ToolProbeBatchResponse

      expect(body.results).toEqual([])
      expect(body.error).toBe('ssh: connect to host kali.lan port 22: No route to host')
    })

    it('probes a saved LOCAL profile on this machine instead of shelling out', async () => {
      const local: BackendProfile = { id: 'be-l', name: 'here', kind: 'local', createdAt: '', updatedAt: '' }
      const { run, count } = runner({})
      const app = makeApp([], stub({ nmap: { installed: true, version: 'nmap 7.94' } }), { backends: [local], run })
      const body = (await (await postBatch(app, { backendId: 'be-l', programs: ['nmap'] })).json()) as ToolProbeBatchResponse

      expect(count()).toBe(0)
      expect(body.results).toEqual([{ program: 'nmap', installed: true, version: 'nmap 7.94' }])
    })

    it('guards the batch behind the bearer token', async () => {
      const res = await makeApp([], stub({})).request('/api/tools/probe-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ programs: ['nmap'] }),
      })
      expect(res.status).toBe(401)
    })
  })
})
