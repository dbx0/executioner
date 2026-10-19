import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphSchema } from '@exe/graph'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'

let dir: string
let project: Project
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-execset-'))
  project = createProject(dir, { name: 'test' })
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const failer: ToolManifest = toolManifestSchema.parse({
  id: 'failer',
  name: 'failer',
  description: 'exits nonzero',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'process.exit(1)'] },
  emit: { parser: 'json' },
})
const sleeper: ToolManifest = toolManifestSchema.parse({
  id: 'sleeper',
  name: 'sleeper',
  description: 'sleeps',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 1000)'] },
  emit: { parser: 'json' },
})
const ok: ToolManifest = toolManifestSchema.parse({
  id: 'ok',
  name: 'ok',
  description: 'emits ok',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify({ok:true}))'] },
  emit: { parser: 'json' },
})
const manifests = new Map<string, ToolManifest>([
  ['failer', failer],
  ['sleeper', sleeper],
  ['ok', ok],
])

function run(_graph: unknown) {
  const executor = new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs })
  return executor
}

describe('per-node execution settings', () => {
  it('__on_failure=stop halts the run so downstream nodes are skipped', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'failer', data: { __on_failure: 'stop' } },
        { id: 'b', type: 'ok', data: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })
    const executor = run(graph)
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    const nodes = executor['store'].nodesFor(result.executionId)
    expect(nodes.find((n) => n.nodeId === 'a')?.status).toBe('failed')
    expect(nodes.find((n) => n.nodeId === 'b')).toBeUndefined() // downstream skipped
  })

  it('default on_failure continues past a failed node', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'failer', data: {} },
        { id: 'b', type: 'ok', data: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })
    const executor = run(graph)
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    const nodes = executor['store'].nodesFor(result.executionId)
    expect(nodes.find((n) => n.nodeId === 'b')?.status).toBe('succeeded') // still ran
  })

  it('__timeout_ms overrides the manifest timeout', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [{ id: 's', type: 'sleeper', data: { __timeout_ms: 50 } }],
      edges: [],
    })
    const executor = run(graph)
    const result = await executor.run({ graph, workflowId: null, targetId: target.id, testMode: false })
    expect(executor['store'].nodesFor(result.executionId).find((n) => n.nodeId === 's')?.status).toBe('timeout')
  })
})
