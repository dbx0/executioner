import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graphSchema } from '@exe/graph'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { CancellationRegistry } from './cancellation.js'
import { GraphExecutor } from './graph-executor.js'
import { EXECUTION_CHANNEL } from './graph-executor/types.js'
import type { RunRepository } from '@exe/db'

let dir: string
let project: Project
/**
 * Polls a run's state until it holds. vi.waitFor gives up after 1s by default,
 * which a spawn can outlast under a full-suite load; this cap only stops a hung
 * test, and a pass never waits on it.
 */
const PATIENCE = { timeout: 20_000, interval: 20 }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-cancel-'))
  project = createProject(dir, { name: 'test' })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A tool that stays alive far longer than the test: what a stop must kill. */
const sleeper: ToolManifest = toolManifestSchema.parse({
  id: 'sleeper',
  name: 'sleeper',
  description: 'sleeps until it is killed',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], timeout_ms: 60_000 },
  emit: { parser: 'json' },
})

const quick: ToolManifest = toolManifestSchema.parse({
  id: 'quick',
  name: 'quick',
  description: 'returns at once',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'process.stdout.write("{}")'] },
  emit: { parser: 'json' },
})

const manifests = new Map<string, ToolManifest>([
  ['sleeper', sleeper],
  ['quick', quick],
])

function setup(): {
  store: RunRepository
  runs: CancellationRegistry
  executor: GraphExecutor
  events: EngineEvent[]
  targetId: string
} {
  const bus = new EventBus()
  const events: EngineEvent[] = []
  bus.subscribe((e) => events.push(e))
  const store = project.runs
  const runs = new CancellationRegistry()
  const executor = new GraphExecutor({ project, bus, manifests, store, runs })
  const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
  return { store, runs, executor, events, targetId: target.id }
}

describe('stopping a run', () => {
  it('kills the running tool and settles the run as cancelled', async () => {
    const { store, runs, executor, events, targetId } = setup()
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'sleeper', data: {} },
        { id: 'b', type: 'quick', data: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })

    let executionId = ''
    const run = executor.run({
      graph,
      workflowId: null,
      targetId,
      testMode: false,
      onExecutionCreated: (id) => {
        executionId = id
      },
    })

    // Stop it while the sleeper is mid-flight. Without the process being killed
    // this run would sit here for the tool's full 60s timeout.
    await vi.waitFor(() => {
      expect(store.nodesFor(executionId).some((n) => n.nodeId === 'a' && n.status === 'running')).toBe(true)
    }, PATIENCE)
    expect(runs.cancel(executionId)).toBe(true)

    const result = await run
    expect(result.status).toBe('cancelled')

    const execution = store.getExecution(executionId)
    expect(execution?.status).toBe('cancelled')
    expect(execution?.finishedAt).not.toBeNull()

    // The node that was killed is settled, and the one after it never started.
    const nodes = store.nodesFor(executionId)
    expect(nodes.find((n) => n.nodeId === 'a')?.status).toBe('cancelled')
    expect(nodes.some((n) => n.nodeId === 'b')).toBe(false)
    expect(events.some((e) => e.nodeId === EXECUTION_CHANNEL && e.data === 'cancelled')).toBe(true)
  }, 60_000)

  it('stops before the next node when the cancel lands between nodes', async () => {
    const { store, runs, executor, targetId } = setup()
    const graph = graphSchema.parse({
      nodes: [
        { id: 'a', type: 'quick', data: {} },
        { id: 'b', type: 'quick', data: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })

    let executionId = ''
    const result = await executor.run({
      graph,
      workflowId: null,
      targetId,
      testMode: false,
      onExecutionCreated: (id) => {
        executionId = id
      },
      // The gate the step-through runs use is also where a cancel is noticed.
      beforeNode: async (nodeId) => {
        if (nodeId === 'b') runs.cancel(executionId)
        await Promise.resolve()
      },
    })

    expect(result.status).toBe('cancelled')
    const nodes = store.nodesFor(executionId)
    expect(nodes.find((n) => n.nodeId === 'a')?.status).toBe('succeeded')
    expect(nodes.some((n) => n.nodeId === 'b')).toBe(false)
  })

  it('forgets the run once it has finished, so a late stop does nothing', async () => {
    const { runs, executor, targetId } = setup()
    const graph = graphSchema.parse({ nodes: [{ id: 'a', type: 'quick', data: {} }], edges: [] })

    const result = await executor.run({ graph, workflowId: null, targetId, testMode: false })
    expect(result.status).toBe('succeeded')
    expect(runs.isRunning(result.executionId)).toBe(false)
    expect(runs.cancel(result.executionId)).toBe(false)
  })
})
