import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { EventBus } from '../transport/events.js'
import { Executor } from '../execution/executor.js'
import { createApp } from '../transport/server.js'

const TOKEN = 'a'.repeat(40)
const auth = { headers: { authorization: `Bearer ${TOKEN}` } }

let root: string
let project: Project
let app: ReturnType<typeof createApp>
/** Every run the executor started, by id, so nothing outlives the database. */
let inFlight: Map<string, Promise<unknown>>

/** A stand-in tool backed by node, so no security binary is needed. */
const echoHost: ToolManifest = toolManifestSchema.parse({
  id: 'echo-host',
  name: 'Echo Host',
  description: 'emits the target host as a JSON record',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({host: process.argv[1]}))', '{{ target.value }}'],
  },
  emit: { parser: 'json' },
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-standalone-'))
  project = createProject(root, { name: 'acme' })
  const bundled = loadManifests(bundledManifestsDir())
  bundled.set(echoHost.id, echoHost)
  const registry = new NodeRegistry(bundled)
  const executor = new Executor(project, new EventBus())
  inFlight = new Map()
  const start = executor.start.bind(executor)
  executor.start = (...args) => {
    const result = start(...args)
    inFlight.set(result.executionId, result.settled)
    return result
  }
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(async () => {
  // A child still writing its row when the database closes throws from a
  // handler no test is awaiting, so drain every run first.
  await Promise.all(inFlight.values())
  project.close()
  rmSync(root, { recursive: true, force: true })
})

/** A domain target to run against. */
function target(): string {
  return project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' }).id
}

/** POST /api/executions with a JSON body. */
async function startRun(body: unknown): Promise<Response> {
  return await app.request('/api/executions', {
    method: 'POST',
    headers: { ...auth.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Wait for the run the executor started under this id to finish. */
async function settle(executionId: string): Promise<void> {
  await inFlight.get(executionId)
}

/**
 * Start a run and wait for it to finish. Every test does this: a child still
 * writing its row when `afterEach` closes the database would throw from a
 * handler no test is awaiting.
 */
async function runToCompletion(body: unknown): Promise<string> {
  const res = await startRun(body)
  expect(res.status).toBe(202)
  const { executionId } = (await res.json()) as { executionId: string }
  await settle(executionId)
  return executionId
}

describe('GET /api/nodes', () => {
  it('names the binary each node invokes, so a client can check availability', async () => {
    const res = await app.request('/api/nodes', auth)
    const nodes = (await res.json()) as { id: string; program?: string }[]
    expect(nodes.find((n) => n.id === 'echo-host')?.program).toBe(process.execPath)
  })
})

/** POST /api/nodes/:id/preview with a JSON body. */
async function preview(id: string, body: unknown): Promise<Response> {
  return await app.request(`/api/nodes/${id}/preview`, {
    method: 'POST',
    headers: { ...auth.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/nodes/:id/preview', () => {
  it('builds the argv a run would execute against the picked target', async () => {
    const res = await preview('nmap', { targetId: target(), params: { ports: '80,443' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ program: 'nmap', args: ['-sV', '-T3', '-p', '80,443', 'example.com'] })
  })

  it('shows a stand-in until a target is picked', async () => {
    const res = await preview('nmap', { params: {} })
    const { args } = (await res.json()) as { args: string[] }
    expect(args.at(-1)).toBe('<target>')
  })

  it('names the param that keeps the command from being built', async () => {
    const res = await preview('hydra', { params: {} })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toMatch(/param "\w+" is required/)
  })

  it('refuses an unknown tool or target', async () => {
    expect((await preview('nope', { params: {} })).status).toBe(404)
    expect((await preview('nmap', { targetId: 'gone', params: {} })).status).toBe(404)
  })
})

describe('POST /api/executions with a connection', () => {
  it('runs on this machine when no connection is named', async () => {
    const executionId = await runToCompletion({ nodeId: 'echo-host', targetId: target(), params: {} })
    expect(project.executions.get(executionId)?.backend).toBe('local')
  })

  it('treats the explicit "local" id as this machine', async () => {
    const executionId = await runToCompletion({
      nodeId: 'echo-host',
      targetId: target(),
      backendProfileId: 'local',
      params: {},
    })
    expect(project.executions.get(executionId)?.backend).toBe('local')
  })

  it('rejects a connection it does not know rather than quietly running locally', async () => {
    const res = await startRun({ nodeId: 'echo-host', targetId: target(), backendProfileId: 'be-nope', params: {} })
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toEqual({ error: 'unknown backend profile' })
  })

  it('records the connection kind the run used', async () => {
    const profile = project.backends.create({ name: 'box', kind: 'docker', image: 'alpine' })
    // No docker here, so the run fails — what matters is the row says where it
    // was sent, and that the failure names the backend rather than hiding it.
    const executionId = await runToCompletion({
      nodeId: 'echo-host',
      targetId: target(),
      backendProfileId: profile.id,
      params: {},
    })
    const row = project.executions.get(executionId)
    expect(row?.backend).toBe('docker')
    // The kind alone cannot tell two docker profiles apart; the id can.
    expect(project.executions.listStandalone()[0]!.backendProfileId).toBe(profile.id)
  })

  it('records no profile for a run on this machine', async () => {
    await runToCompletion({ nodeId: 'echo-host', targetId: target(), backendProfileId: 'local', params: {} })
    expect(project.executions.listStandalone()[0]!.backendProfileId).toBeNull()
  })
})

describe('GET /api/executions/:id/output for a standalone run', () => {
  it('returns the records the tool output parsed into, as a workflow node does', async () => {
    const executionId = await runToCompletion({ nodeId: 'echo-host', targetId: target(), params: {} })
    const res = await app.request(`/api/executions/${executionId}/output`, auth)
    const rows = (await res.json()) as { nodeId: string; stdout: string; parsed: unknown }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.nodeId).toBe('echo-host')
    expect(rows[0]!.stdout).toBe('{"host":"example.com"}')
    expect(rows[0]!.parsed).toEqual([{ host: 'example.com' }])
  })
})

describe('GET /api/executions/standalone', () => {
  it('guards the route behind the bearer token', async () => {
    expect((await app.request('/api/executions/standalone')).status).toBe(401)
  })

  it('lists a standalone run with its params and its target value', async () => {
    const targetId = target()
    const executionId = await runToCompletion({ nodeId: 'echo-host', targetId, params: { ports: '80,443' } })

    const list = (await (await app.request('/api/executions/standalone', auth)).json()) as {
      id: string
      nodeId: string
      params: Record<string, unknown>
      targetValue: string | null
      backend: string
    }[]

    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(executionId)
    expect(list[0]!.nodeId).toBe('echo-host')
    expect(list[0]!.params).toEqual({ ports: '80,443' })
    expect(list[0]!.targetValue).toBe('example.com')
    expect(list[0]!.backend).toBe('local')
  })

  it('excludes workflow runs, which are not standalone', async () => {
    const targetId = target()
    await runToCompletion({ nodeId: 'echo-host', targetId, params: {} })

    // A workflow-owned execution, written the way a workflow run writes it.
    const run = project.runs.createExecution({ workflowId: 'wf-1', targetId, backend: 'local', testMode: false })
    project.runs.startNode({ executionId: run.id, nodeId: 'echo-host' })
    project.runs.finishExecution(run.id, 'succeeded')

    const list = (await (await app.request('/api/executions/standalone', auth)).json()) as { id: string }[]
    expect(list.map((r) => r.id)).not.toContain(run.id)
    expect(list).toHaveLength(1)
  })

  it('caps the limit so a client cannot ask for the whole table', async () => {
    const res = await app.request('/api/executions/standalone?limit=99999', auth)
    expect(res.status).toBe(200)
  })
})
