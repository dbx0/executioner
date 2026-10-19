import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graphSchema } from '@exe/graph'
import type { ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'

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
  it('records facts using CENSYS_API_ID/SECRET secrets', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify({ result: { services: [{ port: 443, transport_protocol: 'TCP', service_name: 'HTTP' }] } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    project.secrets.set('CENSYS_API_ID', 'id')
    project.secrets.set('CENSYS_API_SECRET', 'sec')
    const target = project.targets.upsert({ kind: 'ip', value: '8.8.8.8', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'c', type: 'censys', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    const init = must(fetchMock.mock.calls[0]?.[1])
    expect((init.headers as Record<string, string>).authorization).toContain('Basic ')
    expect(project.facts.forTarget(target.id, 'port')).toHaveLength(1)
    expect(project.facts.forTarget(target.id, 'technology')).toHaveLength(1)
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
  it('records a screenshot fact when a chrome binary produces the image', async () => {
    // A fake "chrome" that writes the PNG requested via --screenshot=<path>.
    const fake = join(dir, 'fake-chrome.sh')
    writeFileSync(
      fake,
      '#!/bin/sh\nfor a in "$@"; do\n  case "$a" in\n    --screenshot=*) printf "PNG" > "${a#--screenshot=}" ;;\n  esac\ndone\n',
    )
    chmodSync(fake, 0o755)
    process.env.CHROME_PATH = fake
    const target = project.targets.upsert({ kind: 'url', value: 'https://example.com', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'sc', type: 'screenshot', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    expect(project.facts.forTarget(target.id, 'screenshot')).toHaveLength(1)
  })
})
