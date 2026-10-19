import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphSchema } from '@exe/graph'
import type { ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'
import type { RunRepository } from '@exe/db'

let dir: string
let project: Project
const manifests = new Map<string, ToolManifest>()

/** A manifest for a program that is guaranteed not to exist on any machine. */
const missingTool: ToolManifest = {
  id: 'ghost',
  name: 'Ghost',
  description: 'a tool that is not installed',
  category: 'recon',
  accepts: ['domain', 'subdomain'],
  params: {},
  command: {
    program: 'executioner-no-such-binary',
    args: ['{{ target.value }}'],
    timeout_ms: 30_000,
  },
  emit: { parser: 'regex', source: 'stdout', pattern: '(?<host>\\S+)', facts: [], targets: [] },
} as unknown as ToolManifest

/** A manifest for a program that reads stdin until EOF, like the ProjectDiscovery
 *  tools do. It only terminates if the runner closes stdin. */
const stdinTool: ToolManifest = {
  ...missingTool,
  id: 'reads-stdin',
  command: { program: 'cat', args: [], timeout_ms: 5_000 },
} as unknown as ToolManifest

/** A manifest that echoes its target, so a run can assert what it was aimed at. */
const echoTool: ToolManifest = {
  ...missingTool,
  id: 'echo',
  command: { program: 'echo', args: ['{{ target.value }}'], timeout_ms: 30_000 },
} as unknown as ToolManifest

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-diag-'))
  project = createProject(dir, { name: 'test' })
  manifests.set('ghost', missingTool)
  manifests.set('echo', echoTool)
  manifests.set('reads-stdin', stdinTool)
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
  manifests.clear()
})

function newExecutor(): GraphExecutor {
  return new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs })
}

const nodesOf = (exec: GraphExecutor, id: string): ReturnType<RunRepository['nodesFor']> =>
  exec['store'].nodesFor(id)

describe('a tool that is not installed on the chosen backend', () => {
  it('says which program could not run instead of recording silence', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'n', type: 'ghost', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const node = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'n')
    expect(node?.status).toBe('failed')
    // A spawn failure has no exit code, which is exactly why it used to be
    // indistinguishable from a process killed by a signal.
    expect(node?.exitCode).toBeNull()

    const stderr = readFileSync(String(node?.stderrPath), 'utf8')
    expect(stderr).toContain('executioner-no-such-binary')
    expect(stderr).toContain('local backend')
    expect(stderr).toContain('ENOENT')
  })

  it('fails the run rather than reporting a green run full of dead nodes', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'n', type: 'ghost', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    expect(result.status).toBe('failed')
    const row = project.runs.getExecution(result.executionId)!
    expect(row.status).toBe('failed')
    expect(row.error).toContain('n')
  })

  it('still reports success when every node passed', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'n', type: 'echo', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(result.status).toBe('succeeded')
  })
})

describe('a tool node that names its own target', () => {
  it('scans the loop item rather than re-scanning the run target', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: { source: '["a.example.com","b.example.com"]' } },
        { id: 'scan', type: 'echo', data: { target: '{{ loop.item }}' } },
      ],
      edges: [{ id: 'e', source: 'loop', target: 'scan' }],
    })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const runDir = project.evidenceDir(result.executionId)
    const out = readFileSync(join(runDir, 'scan.stdout'), 'utf8')
    // The last iteration's output wins the file; the point is that it is the
    // loop item, not the apex the run was started against.
    expect(out.trim()).toBe('b.example.com')
  })

  it('records the item as a real target under the run target, so facts land on it', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: { source: '["sub.example.com"]' } },
        { id: 'scan', type: 'echo', data: { target: '{{ loop.item }}' } },
      ],
      edges: [{ id: 'e', source: 'loop', target: 'scan' }],
    })
    const exec = newExecutor()
    await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const child = project.targets.findByValue('subdomain', 'sub.example.com')
    expect(child).toBeDefined()
    expect(child?.parentId).toBe(target.id)
  })

  it('leaves a node without a target override aimed at the run target', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'scan', type: 'echo', data: {} }], edges: [] })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    const out = readFileSync(join(project.evidenceDir(result.executionId), 'scan.stdout'), 'utf8')
    expect(out.trim()).toBe('example.com')
  })
})

describe('built-in nodes inside a loop body', () => {
  it('runs a python_script per item instead of failing for want of a manifest', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: { source: '["a.example.com","b.example.com"]' } },
        // The loop item has to reach the script, or it silently scans nothing.
        { id: 'probe', type: 'python_script', data: { script: 'print("saw {{ loop.item }}")' } },
      ],
      edges: [{ id: 'e', source: 'loop', target: 'probe' }],
    })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    const node = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'probe')
    expect(node?.status).toBe('succeeded')
    const out = readFileSync(join(project.evidenceDir(result.executionId), 'probe.stdout'), 'utf8')
    expect(out).toContain('saw b.example.com')
  })

  it('lets an if inside the body gate only its own iteration', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: { source: '["keep","drop"]' } },
        { id: 'gate', type: 'if', data: { expression: 'true' } },
        { id: 'after', type: 'python_script', data: { script: 'print("ran for {{ loop.item }}")' } },
      ],
      edges: [
        { id: 'e1', source: 'loop', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'after' },
      ],
    })
    const exec = newExecutor()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    // The if no longer fails outright, and the body node behind it still runs.
    const gate = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'gate')
    expect(gate?.status).not.toBe('failed')
    const out = readFileSync(join(project.evidenceDir(result.executionId), 'after.stdout'), 'utf8')
    expect(out).toContain('ran for drop')
  })
})

describe('an IF node', () => {
  const ifGraph = (expression: string) =>
    graphSchema.parse({
      nodes: [
        { id: 'probe', type: 'python_script', data: { script: 'import json; print(json.dumps({"alive": True}))' } },
        { id: 'gate', type: 'if', data: { expression } },
        { id: 'after', type: 'echo', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'probe', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'after', sourceHandle: 'true' },
      ],
    })

  it('resolves a {{ … }} condition instead of compiling it to a syntax error', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const exec = newExecutor()
    const result = await exec.run({
      graph: ifGraph('{{ nodes.probe.alive }}'),
      workflowId: null,
      targetId: target.id,
      testMode: false,
    })

    const gate = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'gate')
    expect(gate?.status).toBe('succeeded')
    // The true branch was taken, so the downstream node actually ran.
    expect(nodesOf(exec, result.executionId).find((n) => n.nodeId === 'after')?.status).toBe('succeeded')
  })

  it('records the branch it took, so an IF is visible in the run', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const exec = newExecutor()
    const result = await exec.run({
      graph: ifGraph('data.alive === false'),
      workflowId: null,
      targetId: target.id,
      testMode: false,
    })

    const gate = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'gate')
    expect(gate?.status).toBe('succeeded')
    expect(JSON.stringify(gate?.parsedOutput)).toContain('"branch":"false"')
    // A genuine false still skips the downstream.
    expect(nodesOf(exec, result.executionId).find((n) => n.nodeId === 'after')).toBeUndefined()
  })

  it('matches a regex condition on the linear-time engine', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const exec = newExecutor()
    const result = await exec.run({
      graph: ifGraph('new RegExp("^tr").test(String(data.alive))'),
      workflowId: null,
      targetId: target.id,
      testMode: false,
    })

    const gate = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'gate')
    expect(gate?.status).toBe('succeeded')
    expect(nodesOf(exec, result.executionId).find((n) => n.nodeId === 'after')?.status).toBe('succeeded')
  })

  it('refuses a condition that reaches for the runtime, and says where', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const exec = newExecutor()
    const result = await exec.run({
      graph: ifGraph('data.constructor.constructor("return process")()'),
      workflowId: null,
      targetId: target.id,
      testMode: false,
    })

    const gate = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'gate')
    expect(gate?.status).toBe('failed')
    expect(JSON.stringify(gate?.parsedOutput)).toContain('\\"constructor\\" cannot be read at position 6')
    expect(nodesOf(exec, result.executionId).find((n) => n.nodeId === 'after')).toBeUndefined()
  })

  it('fails visibly when the condition cannot be evaluated', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const exec = newExecutor()
    const result = await exec.run({
      graph: ifGraph('nonsense.that.throws'),
      workflowId: null,
      targetId: target.id,
      testMode: false,
    })

    const gate = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'gate')
    expect(gate?.status).toBe('failed')
    expect(result.status).toBe('failed')
  })
})

describe('a tool that reads stdin', () => {
  it('is not left hanging on an open stdin pipe', async () => {
    // `cat` with no arguments blocks until EOF. Spawn leaves stdin an open pipe,
    // so without an explicit close this node runs to its timeout producing
    // nothing — exactly what katana did for 300s a run.
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({ nodes: [{ id: 'n', type: 'reads-stdin', data: {} }], edges: [] })
    const exec = newExecutor()

    const started = Date.now()
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    const elapsed = Date.now() - started

    const node = nodesOf(exec, result.executionId).find((n) => n.nodeId === 'n')
    expect(node?.status).toBe('succeeded')
    expect(node?.exitCode).toBe(0)
    // It must exit on EOF, nowhere near the 5s manifest timeout.
    expect(elapsed).toBeLessThan(3000)
  })
})
