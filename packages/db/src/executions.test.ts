import { describe, expect, it } from 'vitest'
import { openDatabase } from './index.js'
import { TargetRepository } from './targets.js'
import { ExecutionRepository } from './executions.js'
import { RunRepository } from './runs.js'
import { nodeExecutions } from './tables.js'

function setup() {
  const db = openDatabase(':memory:')
  const targets = new TargetRepository(db)
  const target = targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
  const executions = new ExecutionRepository(db)
  return { db, executions, target }
}

describe('ExecutionRepository', () => {
  it('creates a running execution and reads it back', () => {
    const { executions, target } = setup()
    const id = executions.create({ targetId: target.id, nodeId: 'subfinder' })
    const summary = executions.get(id)
    expect(summary?.status).toBe('running')
    expect(summary?.nodeId).toBe('subfinder')
    expect(summary?.targetId).toBe(target.id)
    expect(summary?.backend).toBe('local')
    expect(summary?.parsedCount).toBe(0)
  })

  it('finishes an execution with status, exit code, paths and parsed rows', () => {
    const { executions, target } = setup()
    const id = executions.create({ targetId: target.id, nodeId: 'subfinder' })
    executions.finish(id, {
      status: 'succeeded',
      exitCode: 0,
      stdoutPath: '/e/exec/stdout.log',
      stderrPath: '/e/exec/stderr.log',
      parsed: [{ host: 'a.example.com' }, { host: 'b.example.com' }],
      error: null,
    })
    const summary = executions.get(id)
    expect(summary?.status).toBe('succeeded')
    expect(summary?.exitCode).toBe(0)
    expect(summary?.stdoutPath).toBe('/e/exec/stdout.log')
    expect(summary?.parsedCount).toBe(2)
    expect(summary?.finishedAt).not.toBeNull()
  })

  it('records a failure with an error message', () => {
    const { executions, target } = setup()
    const id = executions.create({ targetId: target.id, nodeId: 'nmap' })
    executions.finish(id, {
      status: 'failed',
      exitCode: 3,
      stdoutPath: null,
      stderrPath: null,
      parsed: [],
      error: 'process exited 3',
    })
    expect(executions.get(id)?.error).toBe('process exited 3')
  })

  it('returns undefined for an unknown id', () => {
    const { executions } = setup()
    expect(executions.get('nope')).toBeUndefined()
  })

  it('keeps the connection profile a standalone run used', () => {
    const { executions, target } = setup()
    executions.create({ targetId: target.id, nodeId: 'nmap', backend: 'ssh', backendProfileId: 'be-7' })
    executions.create({ targetId: target.id, nodeId: 'nmap' })
    const ids = executions.listStandalone().map((r) => r.backendProfileId)
    expect(ids.sort()).toEqual(['be-7', null].sort())
  })

  it("serves a standalone run's parsed rows the way a workflow node's are served", () => {
    const { db, executions, target } = setup()
    const id = executions.create({ targetId: target.id, nodeId: 'subfinder' })
    executions.finish(id, {
      status: 'succeeded',
      exitCode: 0,
      stdoutPath: null,
      stderrPath: null,
      parsed: [{ host: 'a.example.com' }],
      error: null,
    })
    expect(new RunRepository(db).nodesFor(id)[0]?.parsedOutput).toEqual([{ host: 'a.example.com' }])
  })

  it('reads no rows from a run saved before rows were kept, not its counts', () => {
    const { db, executions, target } = setup()
    const id = executions.create({ targetId: target.id, nodeId: 'subfinder' })
    // Older engines stored only how many targets and facts the run emitted.
    db.orm.update(nodeExecutions).set({ status: 'succeeded', parsedOutput: '{"targets":3,"facts":2}' }).run()
    expect(executions.get(id)?.parsedCount).toBe(0)
    expect(new RunRepository(db).nodesFor(id)[0]?.parsedOutput).toBeNull()
  })
})
