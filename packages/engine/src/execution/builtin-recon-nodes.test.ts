import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graphSchema } from '@exe/graph'
import type { ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'
import { findChromeBinary } from './graph-executor/helpers.js'
import type { ScreenshotRequest } from './graph-executor/builtin/screenshot-driver.js'

let dir: string
let project: Project
const manifests = new Map<string, ToolManifest>()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-recon-'))
  project = createProject(dir, { name: 'test' })
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  delete process.env.CHROME_PATH
})

/** Narrow an indexed lookup to a present value, failing loudly if it is missing. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value, got undefined')
  return v
}

function newExecutor(): GraphExecutor {
  return new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs })
}

const nodeStatus = (exec: GraphExecutor, executionId: string, nodeId: string): string | undefined =>
  exec['store'].nodesFor(executionId).find((n) => n.nodeId === nodeId)?.status

describe('geoip node', () => {
  it('records a geolocation fact and succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'success', country: 'US', city: 'NYC' }), { status: 200 })),
    )
    const target = project.targets.upsert({ kind: 'ip', value: '1.1.1.1', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'g', type: 'geoip', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    expect(project.facts.forTarget(target.id, 'geolocation')).toHaveLength(1)
  })

  it('fails cleanly when the API reports status=fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'fail', message: 'private range' }), { status: 200 })))
    const target = project.targets.upsert({ kind: 'ip', value: '10.0.0.1', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'g', type: 'geoip', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(nodeStatus(exec, result.executionId, 'g')).toBe('failed')
    expect(project.facts.forTarget(target.id, 'geolocation')).toHaveLength(0)
  })
})

describe('shodan node', () => {
  it('records port and technology facts using the SHODAN_API_KEY secret', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(
        JSON.stringify({ ip_str: '1.1.1.1', hostnames: ['a.example'], ports: [80], data: [{ port: 80, transport: 'tcp', product: 'nginx', version: '1.0' }] }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    project.secrets.set('SHODAN_API_KEY', 'k')
    const target = project.targets.upsert({ kind: 'ip', value: '1.1.1.1', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 's', type: 'shodan', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('key=k')
    expect(project.facts.forTarget(target.id, 'port')).toHaveLength(1)
    expect(project.facts.forTarget(target.id, 'technology')).toHaveLength(1)
  })

  it('fails cleanly when the key is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const target = project.targets.upsert({ kind: 'ip', value: '1.1.1.1', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 's', type: 'shodan', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(nodeStatus(exec, result.executionId, 's')).toBe('failed')
    expect(project.facts.forTarget(target.id, 'port')).toHaveLength(0)
  })
})

describe('censys node', () => {
  it('records facts using the CENSYS_API_TOKEN secret', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(
        JSON.stringify({
          result: {
            resource: {
              services: [
                { port: 443, transport_protocol: 'tcp', protocol: 'HTTP' },
                { port: 443, transport_protocol: 'quic', protocol: 'UNKNOWN' },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    project.secrets.set('CENSYS_API_TOKEN', 'censys_tok')
    const target = project.targets.upsert({ kind: 'ip', value: '8.8.8.8', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'c', type: 'censys', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.platform.censys.io/v3/global/asset/host/8.8.8.8')
    const headers = must(fetchMock.mock.calls[0]?.[1]).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer censys_tok')
    expect(headers['x-organization-id']).toBeUndefined()
    expect(project.facts.forTarget(target.id, 'port')).toHaveLength(2)
    expect(project.facts.forTarget(target.id, 'technology')).toHaveLength(1)
  })

  it('sends the organization ID when CENSYS_ORG_ID is set', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify({ result: { resource: { services: [] } } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    project.secrets.set('CENSYS_API_TOKEN', 'censys_tok')
    project.secrets.set('CENSYS_ORG_ID', 'org-123')
    const target = project.targets.upsert({ kind: 'ip', value: '8.8.8.8', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'c', type: 'censys', data: {} }], edges: [] })
    const result = await newExecutor().run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    const headers = must(fetchMock.mock.calls[0]?.[1]).headers as Record<string, string>
    expect(headers['x-organization-id']).toBe('org-123')
  })

  it('fails cleanly when creds are missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const target = project.targets.upsert({ kind: 'ip', value: '8.8.8.8', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'c', type: 'censys', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(nodeStatus(exec, result.executionId, 'c')).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('python_script node', () => {
  it('runs the script and parses printed JSON as rows', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        {
          id: 'p',
          type: 'python_script',
          data: { script: 'import json\nprint(json.dumps({"host": "{{ target.value }}", "ok": True}))' },
        },
      ],
      edges: [],
    })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    const rows = exec['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'p')?.parsedOutput as Array<{ host: string; ok: boolean }>
    expect(rows[0]?.host).toBe('example.com')
    expect(rows[0]?.ok).toBe(true)
    expect(project.facts.forTarget(target.id, 'raw_output')).toHaveLength(1)
  })
})

describe('screenshot node', () => {
  /** An executor whose screenshot driver is a stub, so the node runs without a browser. */
  function executorWithDriver(driver: (req: ScreenshotRequest) => Promise<Buffer>): GraphExecutor {
    return new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs, captureScreenshot: driver })
  }

  it('hands the driver templated headers and full_page, then records the PNG it returns', async () => {
    const seen: ScreenshotRequest[] = []
    const exec = executorWithDriver(async (req) => {
      seen.push(req)
      return Buffer.from('PNG-BYTES')
    })
    const target = project.targets.upsert({ kind: 'url', value: 'https://example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        {
          id: 'sc',
          type: 'screenshot',
          data: { headers: '{"X-Bug-Hunter":"{{ target.value }}"}', full_page: true },
        },
      ],
      edges: [],
    })
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    // The header value is interpolated against the run scope, like http_request.
    expect(seen[0]?.headers['x-bug-hunter']).toBe(target.value)
    expect(seen[0]?.fullPage).toBe(true)
    const facts = project.facts.forTarget(target.id, 'screenshot')
    expect(facts).toHaveLength(1)
    const path = (facts[0]?.data as { path: string }).path
    expect(readFileSync(path).toString()).toBe('PNG-BYTES')
  })

  it('fails the node when the headers param is not valid JSON object of headers', async () => {
    const exec = executorWithDriver(async () => Buffer.from('PNG'))
    const target = project.targets.upsert({ kind: 'url', value: 'https://example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [{ id: 'sc', type: 'screenshot', data: { headers: '{"bad name":"v"}' } }],
      edges: [],
    })
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('failed')
    expect(project.facts.forTarget(target.id, 'screenshot')).toHaveLength(0)
  })

  it('keeps a separate screenshot file per loop iteration', async () => {
    const exec = executorWithDriver(async () => Buffer.from('PNG'))
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: { source: '["a.example.com","b.example.com"]' } },
        { id: 'sc', type: 'screenshot', data: { target: '{{ loop.item }}' } },
      ],
      edges: [{ id: 'e', source: 'loop', target: 'sc' }],
    })
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    const runDir = project.evidenceDir(result.executionId)
    expect(existsSync(join(runDir, 'sc.0.png'))).toBe(true)
    expect(existsSync(join(runDir, 'sc.1.png'))).toBe(true)
  })

  // The real Chrome/CDP path: starts a local page, screenshots it, and proves
  // the node's headers reached the server over the wire. Skipped where no
  // Chrome/Chromium is installed (CI images without a browser).
  it.skipIf(findChromeBinary() === null)(
    'drives real Chrome over CDP and sends the request headers',
    async () => {
      const received: Record<string, string | string[] | undefined> = {}
      const server: Server = createServer((req, res) => {
        Object.assign(received, req.headers)
        res.setHeader('content-type', 'text/html')
        res.end('<html><body style="height:3000px">hi</body></html>')
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      try {
        const target = project.targets.upsert({ kind: 'url', value: `http://127.0.0.1:${String(port)}/`, source: 'manual' })
        const graph = graphSchema.parse({
          nodes: [{ id: 'sc', type: 'screenshot', data: { headers: '{"X-Bug-Hunter":"bx0"}', full_page: true } }],
          edges: [],
        })
        const result = await newExecutor().run({ graph, workflowId: null, targetId: target.id, testMode: false })
        expect(result.status).toBe('succeeded')
        expect(received['x-bug-hunter']).toBe('bx0')
        const path = (project.facts.forTarget(target.id, 'screenshot')[0]?.data as { path: string }).path
        // A real PNG, by its magic number.
        expect([...readFileSync(path).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      } finally {
        server.close()
      }
    },
    60_000,
  )
})
