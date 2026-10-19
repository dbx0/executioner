import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graphSchema } from '@exe/graph'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'
import type { Sender, WireRequest } from './graph-executor/builtin/http-client.js'
import type { Resolver } from './graph-executor/builtin/http-guard.js'

let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-builtins-'))
  project = createProject(dir, { name: 'test' })
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

const emitHost: ToolManifest = toolManifestSchema.parse({
  id: 'emit-host',
  name: 'emit-host',
  description: 'emits the target host',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify({host: process.argv[1]}))', '{{ target.value }}'] },
  emit: { parser: 'json' },
})
const emitSubdomain: ToolManifest = toolManifestSchema.parse({
  id: 'emit-subdomain',
  name: 'emit-subdomain',
  description: 'emits a real subdomain of the target host',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({host: "scan." + process.argv[1]}))', '{{ target.value }}'],
  },
  emit: { parser: 'json' },
})
const echoUpstream: ToolManifest = toolManifestSchema.parse({
  id: 'echo-upstream',
  name: 'echo-upstream',
  description: 'echoes a templated param',
  category: 'test',
  accepts: ['domain'],
  params: { upstream: { type: 'string' } },
  command: { program: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify({value: "got:" + process.argv[1]}))', '{{ params.upstream }}'] },
  emit: { parser: 'json' },
})
const manifests = new Map<string, ToolManifest>([
  ['emit-host', emitHost],
  ['emit-subdomain', emitSubdomain],
  ['echo-upstream', echoUpstream],
])

function newExecutor(bus: EventBus): GraphExecutor {
  return new GraphExecutor({ project, bus, manifests, store: project.runs })
}

describe('built-in data-flow / integration nodes', () => {
  it('set_variable exposes {{ vars.x }} to a downstream tool node', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'v', type: 'set_variable', data: { variables: '{"greet":"scan.example.com"}' } },
        { id: 'e', type: 'echo-upstream', data: { upstream: '{{ vars.greet }}' } },
      ],
      edges: [{ id: 'x', source: 'v', target: 'e' }],
    })
    const exec = newExecutor(new EventBus())
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    const e = exec['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'e')
    expect((e?.parsedOutput as Array<{ value: string }>)?.[0]?.value).toBe('got:scan.example.com')
  })

  it('merge unions the rows of every upstream node', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'emit-host', data: {} },
        { id: 'b', type: 'emit-host', data: {} },
        { id: 'm', type: 'merge', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'm' },
        { id: 'e2', source: 'b', target: 'm' },
      ],
    })
    const exec = newExecutor(new EventBus())
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    const m = exec['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'm')
    expect((m?.parsedOutput as unknown[])?.length).toBe(2)
  })

  it('save_to_target persists an upstream row as a subdomain target', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'emit-subdomain', data: {} },
        { id: 's', type: 'save_to_target', data: { data_type: 'subdomain', field: 'host' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 's' }],
    })
    const exec = newExecutor(new EventBus())
    await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(project.targets.findByValue('subdomain', 'scan.example.com')).toBeDefined()
  })

  it('does not save the apex domain itself as a subdomain of the scanned target', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      // emit-host echoes the target's own value (example.com), the way a
      // subdomain-enum tool includes the apex in its results.
      nodes: [
        { id: 'a', type: 'emit-host', data: {} },
        { id: 's', type: 'save_to_target', data: { data_type: 'subdomain', field: 'host' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 's' }],
    })
    const exec = newExecutor(new EventBus())
    await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    // One value is one target now, so the apex cannot be copied into a second
    // row: it stays the domain it was, at the root, not a child of itself.
    const apex = project.targets.findByValue('domain', 'example.com')
    expect(apex?.kind).toBe('domain')
    expect(apex?.parentId).toBeNull()
    expect(project.targets.all().filter((t) => t.value === 'example.com')).toHaveLength(1)
  })

  describe('http_request', () => {
    let server: Server
    let port: number
    const received: Array<{ url: string; headers: Record<string, unknown>; body: string }> = []
    beforeEach(async () => {
      received.length = 0
      server = createServer((req, res) => {
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString()))
        req.on('end', () => {
          received.push({ url: req.url ?? '', headers: req.headers, body })
          res.setHeader('content-type', 'application/json')
          res.end('{"pong":true}')
        })
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      port = (server.address() as AddressInfo).port
    })
    afterEach(() => new Promise<void>((r) => server.close(() => r())))

    const runNode = async (data: Record<string, unknown>, extra: { enginePort?: () => number } = {}) => {
      const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
      const graph = graphSchema.parse({
        nodes: [
          { id: 'v', type: 'set_variable', data: { variables: '{"name":"x\\",\\"admin\\":true,\\"y\\":\\"","tok":"abc"}' } },
          { id: 'h', type: 'http_request', data },
        ],
        edges: [{ id: 'e', source: 'v', target: 'h' }],
      })
      const exec = new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs, ...extra })
      const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
      const h = exec['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'h')
      const stderr = h?.stderrPath != null ? readFileSync(h.stderrPath, 'utf8') : ''
      return { result, h, stderr }
    }

    it('refuses a loopback url by default, naming the opt-in', async () => {
      const { h, stderr } = await runNode({ method: 'GET', url: `http://127.0.0.1:${String(port)}/` })
      expect(h?.status).toBe('failed')
      expect(received).toHaveLength(0)
      expect(stderr).toContain('is a loopback address')
      expect(stderr).toContain('Allow internal addresses')
    })

    it('refuses a file: url', async () => {
      const { h, stderr } = await runNode({ method: 'GET', url: 'file:///etc/passwd', allow_internal: true })
      expect(h?.status).toBe('failed')
      expect(stderr).toContain('only http and https')
    })

    it('with allow_internal, captures the response and keeps a templated JSON value inside its string', async () => {
      const { result, h } = await runNode({
        method: 'POST',
        url: `http://127.0.0.1:${String(port)}/{{ target.value }}`,
        headers: '{"Authorization":"Bearer {{ vars.tok }}"}',
        body: '{"user":"{{ vars.name }}"}',
        allow_internal: true,
      })
      expect(result.status).toBe('succeeded')
      expect((h?.parsedOutput as Array<{ body: { pong: boolean } }>)?.[0]?.body?.pong).toBe(true)
      expect(received[0]?.url).toBe('/example.com')
      expect(received[0]?.headers.authorization).toBe('Bearer abc')
      expect(received[0]?.headers['content-type']).toBe('application/json')
      expect(JSON.parse(received[0]?.body ?? '')).toEqual({ user: 'x","admin":true,"y":"' })
    })

    it("refuses an address the engagement's scope rules exclude", async () => {
      project.scopeRules.add({ effect: 'exclude', pattern: '127.0.0.0/8', note: 'lab' })
      const { h, stderr } = await runNode({ method: 'GET', url: `http://127.0.0.1:${String(port)}/`, allow_internal: true })
      expect(h?.status).toBe('failed')
      expect(received).toHaveLength(0)
      expect(stderr).toContain("out of the engagement's scope (excluded by 127.0.0.0/8 (lab))")
    })

    it('never calls the engine port, even with allow_internal', async () => {
      const { h, stderr } = await runNode(
        { method: 'GET', url: `http://127.0.0.1:${String(port)}/api/secrets`, allow_internal: 'true' },
        { enginePort: () => port },
      )
      expect(h?.status).toBe('failed')
      expect(received).toHaveLength(0)
      expect(stderr).toContain("engine's own API")
    })
  })

  describe('notify', () => {
    let server: Server
    let port: number
    const received: Array<{ method: string; headers: Record<string, unknown>; body: string }> = []
    beforeEach(async () => {
      received.length = 0
      server = createServer((req, res) => {
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString()))
        req.on('end', () => {
          received.push({ method: req.method ?? '', headers: req.headers, body })
          res.statusCode = 204
          res.end()
        })
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      port = (server.address() as AddressInfo).port
    })
    afterEach(() => new Promise<void>((r) => server.close(() => r())))

    const PUBLIC = '93.184.216.34'
    /** Answers hooks.test with a public address; anything else does not resolve. */
    const resolveHost: Resolver = async (host) => {
      if (host === 'hooks.test') return [{ address: PUBLIC, family: 4 }]
      throw new Error('ENOTFOUND')
    }
    /** A wire that never leaves the process: answers from `respond`, recording each hop. */
    const scripted = (
      respond: (req: WireRequest) => { status: number; headers?: Record<string, string> },
    ): { send: Sender; sent: WireRequest[] } => {
      const sent: WireRequest[] = []
      const send: Sender = async (req) => {
        sent.push(req)
        const r = respond(req)
        return { status: r.status, headers: r.headers ?? {}, body: Readable.from([]) }
      }
      return { send, sent }
    }

    const runNotify = async (data: Record<string, unknown>, extra: { enginePort?: () => number; sendHttp?: Sender } = {}) => {
      const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
      const graph = graphSchema.parse({
        nodes: [
          { id: 'v', type: 'set_variable', data: { variables: '{"name":"x\\",\\"admin\\":true,\\"y\\":\\""}' } },
          { id: 'n', type: 'notify', data },
        ],
        edges: [{ id: 'e', source: 'v', target: 'n' }],
      })
      const exec = new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs, resolveHost, ...extra })
      const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
      const n = exec['store'].nodesFor(result.executionId).find((r) => r.nodeId === 'n')
      const stderr = n?.stderrPath != null ? readFileSync(n.stderrPath, 'utf8') : ''
      return { result, n, stderr }
    }

    it('posts to a public webhook, keeping a templated value inside the message', async () => {
      const wire = scripted(() => ({ status: 204 }))
      const { result } = await runNotify(
        { platform: 'slack', webhook_url: 'https://hooks.test/x', message: 'done {{ target.value }} {{ vars.name }}' },
        { sendHttp: wire.send },
      )
      expect(result.status).toBe('succeeded')
      expect(wire.sent).toHaveLength(1)
      expect(wire.sent[0]?.url.toString()).toBe('https://hooks.test/x')
      expect(wire.sent[0]?.pinned.address).toBe(PUBLIC)
      expect(wire.sent[0]?.method).toBe('POST')
      expect(JSON.parse(wire.sent[0]?.body ?? '')).toEqual({ text: 'done example.com x","admin":true,"y":"' })
    })

    it('refuses a webhook on an internal address by default, naming the opt-in', async () => {
      const { n, stderr } = await runNotify({ webhook_url: `http://127.0.0.1:${String(port)}/hook`, message: 'hi' })
      expect(n?.status).toBe('failed')
      expect(received).toHaveLength(0)
      expect(stderr).toContain('is a loopback address')
      expect(stderr).toContain('Allow internal addresses')
    })

    it('with allow_internal, posts to an internal webhook such as a local relay', async () => {
      const { result } = await runNotify({
        platform: 'discord',
        webhook_url: `http://127.0.0.1:${String(port)}/hook`,
        message: 'done {{ vars.name }}',
        allow_internal: true,
      })
      expect(result.status).toBe('succeeded')
      expect(received).toHaveLength(1)
      expect(received[0]?.method).toBe('POST')
      expect(received[0]?.headers['content-type']).toBe('application/json')
      expect(JSON.parse(received[0]?.body ?? '')).toEqual({ content: 'done x","admin":true,"y":"' })
    })

    it('never calls the engine port, even with allow_internal', async () => {
      const { n, stderr } = await runNotify(
        { webhook_url: `http://127.0.0.1:${String(port)}/api/secrets`, message: 'hi', allow_internal: 'true' },
        { enginePort: () => port },
      )
      expect(n?.status).toBe('failed')
      expect(received).toHaveLength(0)
      expect(stderr).toContain("engine's own API")
    })

    it('refuses a redirect from a public webhook to an internal address', async () => {
      const wire = scripted((req) =>
        req.url.hostname === 'hooks.test'
          ? { status: 307, headers: { location: `http://127.0.0.1:${String(port)}/hook` } }
          : { status: 204 },
      )
      const { n, stderr } = await runNotify({ webhook_url: 'https://hooks.test/x', message: 'hi' }, { sendHttp: wire.send })
      expect(n?.status).toBe('failed')
      expect(wire.sent).toHaveLength(1)
      expect(received).toHaveLength(0)
      expect(stderr).toContain('is a loopback address')
    })

    it('refuses a non-http webhook url', async () => {
      const { n, stderr } = await runNotify({ webhook_url: 'file:///etc/passwd', message: 'hi', allow_internal: true })
      expect(n?.status).toBe('failed')
      expect(stderr).toContain('only http and https')
    })
  })
})
