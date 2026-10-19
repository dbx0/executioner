import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphSchema } from '@exe/graph'
import { PtyRegistry } from '@exe/pty'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { AgentRunner } from '../agents/agent-runner.js'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'
import type { ToolsetDeps } from '../mcp/toolset.js'

let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-graphexec-'))
  project = createProject(dir, { name: 'test' })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

// Two stand-in tool manifests backed by node, so no security binaries are needed.
const emitHost: ToolManifest = toolManifestSchema.parse({
  id: 'emit-host',
  name: 'emit-host',
  description: 'emits the target host as a JSON record',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({host: process.argv[1]}))', '{{ target.value }}'],
  },
  emit: { parser: 'json' },
})

const echoUpstream: ToolManifest = toolManifestSchema.parse({
  id: 'echo-upstream',
  name: 'echo-upstream',
  description: 'echoes a templated upstream param back as a JSON record',
  category: 'test',
  accepts: ['domain'],
  params: { upstream: { type: 'string' } },
  command: {
    program: process.execPath,
    args: [
      '-e',
      'process.stdout.write(JSON.stringify({value: "got:" + process.argv[1]}))',
      '{{ params.upstream }}',
    ],
  },
  emit: { parser: 'json' },
})

const manifests = new Map<string, ToolManifest>([
  ['emit-host', emitHost],
  ['echo-upstream', echoUpstream],
])

// The executor is constructed with the project's run repository, project.runs.
describe('GraphExecutor', () => {
  it('runs a linear graph and threads a prior node field into a later template', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))

    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'emit-host', data: {} },
        { id: 'b', type: 'echo-upstream', data: { upstream: '{{ nodes.a.host }}' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })

    const executor = new GraphExecutor({
      project,
      bus,
      manifests,
      store: project.runs,
    })

    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    expect(result.status).toBe('succeeded')
    const nodeB = executor['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'b')
    // 'b' received the host emitted by 'a'
    const bParsed = nodeB?.parsedOutput as Array<{ value: string }> | null
    expect(bParsed?.[0]?.value).toBe('got:example.com')
  })

  it('skips the non-taken branch of an IF node', async () => {
    const bus = new EventBus()
    const target = project.targets.upsert({ kind: 'domain', value: 'ex.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'if', type: 'if', data: { expression: 'true' } },
        { id: 't', type: 'emit-host', data: {} },
        { id: 'f', type: 'emit-host', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'if', target: 't', sourceHandle: 'true' },
        { id: 'e2', source: 'if', target: 'f', sourceHandle: 'false' },
      ],
    })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const ran = executor['store'].nodesFor(result.executionId).map((n) => n.nodeId)
    expect(ran).toContain('t')
    expect(ran).not.toContain('f')
  })

  it('halts downstream nodes at a STOP node', async () => {
    const bus = new EventBus()
    const target = project.targets.upsert({ kind: 'domain', value: 'stop.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'emit-host', data: {} },
        { id: 'stop', type: 'stop', data: {} },
        { id: 'after', type: 'emit-host', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'stop' },
        { id: 'e2', source: 'stop', target: 'after' },
      ],
    })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const ran = executor['store'].nodesFor(result.executionId).map((n) => n.nodeId)
    expect(ran).not.toContain('after')
  })

  it('runs a loop body once per item', async () => {
    const bus = new EventBus()
    const target = project.targets.upsert({ kind: 'domain', value: 'loop.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: { source: 'a.com\nb.com\nc.com' } },
        { id: 'body', type: 'emit-host', data: {} },
      ],
      edges: [{ id: 'e', source: 'loop', target: 'body' }],
    })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const bodyRuns = executor['store'].nodesFor(result.executionId).filter((n) => n.nodeId === 'body')
    expect(bodyRuns).toHaveLength(3)
  })

  it('passes through a trigger entry node so a triggered workflow runs normally', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))
    const target = project.targets.upsert({ kind: 'domain', value: 'trigger.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'start', type: 'schedule', data: { interval_seconds: 60 } },
        { id: 'a', type: 'emit-host', data: {} },
      ],
      edges: [{ id: 'e', source: 'start', target: 'a' }],
    })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    expect(result.status).toBe('succeeded')
    const nodes = executor['store'].nodesFor(result.executionId)
    // The trigger node runs (succeeded) and the downstream tool node still runs.
    expect(nodes.find((n) => n.nodeId === 'start')?.status).toBe('succeeded')
    expect(nodes.find((n) => n.nodeId === 'a')).toBeDefined()
    const startEvents = events.filter((e) => e.nodeId === 'start')
    expect(startEvents.some((e) => e.type === 'status' && e.data === 'running')).toBe(true)
    expect(startEvents.some((e) => e.type === 'done' && e.data === 'succeeded')).toBe(true)
  })

  it('runs a manual trigger with no downstream as a succeeded no-op', async () => {
    const bus = new EventBus()
    const target = project.targets.upsert({ kind: 'domain', value: 'manual.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [{ id: 'm', type: 'manual', data: {} }],
      edges: [],
    })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
    expect(executor['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'm')?.status).toBe('succeeded')
  })

  it('publishes a final execution status event', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))
    const target = project.targets.upsert({ kind: 'domain', value: 'final.com', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'a', type: 'emit-host', data: {} }], edges: [] })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const execEvents = events.filter((e) => e.nodeId === '__execution__')
    expect(execEvents.map((e) => e.data)).toContain(result.status)
  })
})

describe('GraphExecutor beforeNode gate', () => {
  it('awaits beforeNode before each executing node, in order', async () => {
    const bus = new EventBus()
    const target = project.targets.upsert({ kind: 'domain', value: 'gate.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'emit-host', data: {} },
        { id: 'b', type: 'echo-upstream', data: { upstream: '{{ nodes.a.host }}' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })

    const gated: string[] = []
    const result = await executor.run({
      graph,
      workflowId: null,
      targetId: target.id,
      testMode: false,
      beforeNode: async (nodeId) => {
        gated.push(nodeId)
      },
    })

    expect(result.status).toBe('succeeded')
    // Every executing node was gated, in topological order.
    expect(gated).toEqual(['a', 'b'])
  })

  it('does not run a node until its gate resolves', async () => {
    const bus = new EventBus()
    const target = project.targets.upsert({ kind: 'domain', value: 'step.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'emit-host', data: {} },
        { id: 'b', type: 'emit-host', data: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })
    const executor = new GraphExecutor({ project, bus, manifests, store: project.runs })

    // A manually-controlled gate for node 'b'.
    let releaseB: () => void = () => {}
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve
    })
    // Resolved the moment the executor reaches b's gate, which is after 'a' has
    // finished and before 'b' starts: the point this test inspects.
    let reachedB: () => void = () => {}
    const atBGate = new Promise<void>((resolve) => {
      reachedB = resolve
    })

    let execId = ''
    const runPromise = executor.run({
      graph,
      workflowId: null,
      targetId: target.id,
      testMode: false,
      onExecutionCreated: (id) => {
        execId = id
      },
      beforeNode: async (nodeId) => {
        if (nodeId !== 'b') return
        reachedB()
        await bGate
      },
    })

    // Always release the gate and settle the run, even if an assertion throws,
    // so a blocked run never leaks past this test into DB teardown.
    try {
      // Wait for the executor to reach b's gate, not for a deadline: 'a' is
      // recorded by then, and 'b' must still be held back and absent.
      await Promise.race([
        atBGate,
        runPromise.then((r) => {
          throw new Error(`run ended (${r.status}) without reaching b's gate`)
        }),
      ])
      const before = project.runs.nodesFor(execId).map((n) => n.nodeId)
      expect(before).toContain('a')
      expect(before).not.toContain('b')
    } finally {
      releaseB()
      const result = await runPromise
      expect(result.status).toBe('succeeded')
      const after = project.runs.nodesFor(result.executionId).map((n) => n.nodeId)
      expect(after).toContain('b')
    }
  })
})

describe('GraphExecutor agent node', () => {
  it('runs an agent node and threads its json result downstream', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))
    const target = project.targets.upsert({ kind: 'domain', value: 'agent.com', source: 'manual' })

    const toolsetDeps: ToolsetDeps = {
      project,
      runWorkflow: async () => ({ executionId: '', status: 'success' as const }),
    }
    const registry = new PtyRegistry()
    const agentRunner = new AgentRunner({
      bus,
      project,
      registry,
      buildArgv: () => [
        process.execPath,
        '-e',
        'process.stdout.write("```json\\n{\\"risk\\":\\"high\\"}\\n```")',
      ],
      toolsetDeps,
    })

    const graph = graphSchema.parse({
      nodes: [{ id: 'triage', type: 'agent', data: { prompt: 'assess {{ target.value }}', mode: 'auto' } }],
      edges: [],
    })

    const executor = new GraphExecutor({
      project,
      bus,
      manifests,
      store: project.runs,
      agentRunner,
    })
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const node = executor['store'].nodesFor(result.executionId).find((n) => n.nodeId === 'triage')
    expect(node?.status).toBe('succeeded')
    expect(node?.parsedOutput).toEqual([{ risk: 'high' }])

    // The agent node emits live status so the canvas can paint it.
    const triageEvents = events.filter((e) => e.nodeId === 'triage')
    expect(triageEvents.some((e) => e.type === 'status' && e.data === 'running')).toBe(true)
    expect(triageEvents.some((e) => e.type === 'done' && e.data === 'succeeded')).toBe(true)
  }, 15000)
})
