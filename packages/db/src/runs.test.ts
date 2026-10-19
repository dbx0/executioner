import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type ProjectDatabase } from './index.js'
import { RunRepository } from './runs.js'

let db: ProjectDatabase
let store: RunRepository
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-runs-'))
  db = openDatabase(join(dir, 'p.sqlite'))
  store = new RunRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('RunRepository', () => {
  it('creates an execution in the running state', () => {
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    expect(exec.status).toBe('running')
    expect(store.getExecution(exec.id)?.status).toBe('running')
  })

  it('marks an execution finished', () => {
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    store.finishExecution(exec.id, 'succeeded')
    const reloaded = store.getExecution(exec.id)
    expect(reloaded?.status).toBe('succeeded')
    expect(reloaded?.finishedAt).not.toBeNull()
  })

  it('records a node execution and reads it back', () => {
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    store.recordNode({
      executionId: exec.id,
      nodeId: 'n1',
      status: 'succeeded',
      exitCode: 0,
      stdoutPath: '/e/n1.stdout',
      stderrPath: '/e/n1.stderr',
      parsedOutput: [{ host: 'a.com' }],
    })
    const nodes = store.nodesFor(exec.id)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.nodeId).toBe('n1')
    expect(nodes[0]!.parsedOutput).toEqual([{ host: 'a.com' }])
  })

  it('lists executions newest first', () => {
    const a = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    const b = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    const listed = store.listExecutions()
    expect(listed.map((e) => e.id).slice(0, 2)).toEqual([b.id, a.id])
  })
})

describe('reconcileInterrupted', () => {
  it('closes runs a dead engine left marked running', () => {
    const orphan = store.createExecution({ workflowId: null, targetId: null, backend: 'ssh', testMode: false })
    const done = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    store.finishExecution(done.id, 'succeeded')

    expect(store.reconcileInterrupted('engine stopped')).toBe(1)

    const after = store.getExecution(orphan.id)
    expect(after?.status).toBe('failed')
    expect(after?.error).toBe('engine stopped')
    expect(after?.finishedAt).not.toBeNull()
    // A run that already finished must not be rewritten.
    expect(store.getExecution(done.id)?.status).toBe('succeeded')
  })

  it('is a no-op when nothing was left running', () => {
    expect(store.reconcileInterrupted('engine stopped')).toBe(0)
  })
})

describe('startNode', () => {
  it('makes a node visible while it runs, then settles that same row', () => {
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    store.startNode({ executionId: exec.id, nodeId: 'nmap' })

    const running = store.nodesFor(exec.id)
    expect(running).toHaveLength(1)
    expect(running[0]?.status).toBe('running')
    expect(running[0]?.finishedAt).toBeNull()

    store.recordNode({
      executionId: exec.id,
      nodeId: 'nmap',
      status: 'succeeded',
      exitCode: 0,
      stdoutPath: '/ev/nmap.stdout',
      stderrPath: null,
      parsedOutput: [{ port: '443' }],
    })

    const settled = store.nodesFor(exec.id)
    // Settled in place: one row, not a running row plus a finished one.
    expect(settled).toHaveLength(1)
    expect(settled[0]?.status).toBe('succeeded')
    expect(settled[0]?.exitCode).toBe(0)
    expect(settled[0]?.finishedAt).not.toBeNull()
  })

  it('gives a loop body one row per iteration of the same node', () => {
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    for (const status of ['succeeded', 'failed']) {
      store.startNode({ executionId: exec.id, nodeId: 'sub_nmap' })
      store.recordNode({
        executionId: exec.id,
        nodeId: 'sub_nmap',
        status,
        exitCode: status === 'succeeded' ? 0 : 1,
        stdoutPath: null,
        stderrPath: null,
        parsedOutput: null,
      })
    }
    expect(store.nodesFor(exec.id).map((n) => n.status)).toEqual(['succeeded', 'failed'])
  })

  it('still records a node whose start was never announced', () => {
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    store.recordNode({
      executionId: exec.id,
      nodeId: 'orphan',
      status: 'failed',
      exitCode: null,
      stdoutPath: null,
      stderrPath: null,
      parsedOutput: null,
    })
    expect(store.nodesFor(exec.id)).toHaveLength(1)
  })
})
