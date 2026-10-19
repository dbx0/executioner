import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { isoNow, newId } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { executions, nodeExecutions } from './tables.js'

export interface Execution {
  id: string
  workflowId: string | null
  targetId: string | null
  status: string
  backend: string
  testMode: boolean
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export interface NodeExecution {
  id: string
  executionId: string
  nodeId: string
  status: string
  exitCode: number | null
  stdoutPath: string | null
  stderrPath: string | null
  parsedOutput: unknown
  startedAt: string | null
  finishedAt: string | null
}

/**
 * rowid is SQLite's implicit insertion order, which Drizzle has no column for.
 * It orders node rows the way they were opened, and breaks ties between runs
 * started in the same millisecond.
 */
const executionRowid = sql`${executions}.rowid`
const nodeRowid = sql`${nodeExecutions}.rowid`

/**
 * A standalone run saved before its parsed records were kept stored only how
 * many targets and facts it emitted. Those counts are not rows, and rendering
 * them as a one-row table would misreport what the tool printed.
 */
function isLegacyCounts(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  const record = value as Record<string, unknown>
  return keys.length === 2 && typeof record.targets === 'number' && typeof record.facts === 'number'
}

/** A node's parsed output, or null when the stored text is not valid JSON or
 *  holds only an older standalone run's counts. */
function decodeOutput(text: string | null): unknown {
  if (text === null) return null
  try {
    const value = JSON.parse(text) as unknown
    return isLegacyCounts(value) ? null : value
  } catch {
    return null
  }
}

/**
 * Workflow runs: one execution row per run, plus one node_executions row per
 * node the graph reached. The graph executor writes through this as it walks a
 * graph; the runs list, the MCP toolset and startup reconciliation read it.
 */
export class RunRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  createExecution(input: {
    workflowId: string | null
    targetId: string | null
    backend: string
    testMode: boolean
  }): Execution {
    const exec: Execution = {
      id: newId(),
      workflowId: input.workflowId,
      targetId: input.targetId,
      status: 'running',
      backend: input.backend,
      testMode: input.testMode,
      startedAt: isoNow(),
      finishedAt: null,
      error: null,
    }
    this.orm.insert(executions).values(exec).run()
    return exec
  }

  finishExecution(id: string, status: string, error?: string): void {
    this.orm
      .update(executions)
      .set({ status, finishedAt: isoNow(), error: error ?? null })
      .where(eq(executions.id, id))
      .run()
  }

  /**
   * Close out runs left mid-flight by a previous engine. A run is only ever
   * advanced by the process executing it, so a 'running' row found at startup
   * belongs to a process that is gone — killed, crashed, or shut down under it.
   * Left alone it stays 'running' forever and reads as a job still in progress.
   * Returns how many were reconciled.
   */
  reconcileInterrupted(reason: string): number {
    return this.orm
      .update(executions)
      .set({ status: 'failed', finishedAt: isoNow(), error: reason })
      .where(eq(executions.status, 'running'))
      .run().changes
  }

  /**
   * Settle every node row still open for a run, used when a run is stopped. A
   * killed tool settles itself; this catches anything that was announced but
   * never got to report, so a cancelled run leaves nothing reading as running.
   * Returns how many were closed.
   */
  cancelRunningNodes(executionId: string): number {
    return this.orm
      .update(nodeExecutions)
      .set({ status: 'cancelled', finishedAt: isoNow() })
      .where(and(eq(nodeExecutions.executionId, executionId), eq(nodeExecutions.status, 'running')))
      .run().changes
  }

  getExecution(id: string): Execution | undefined {
    return this.orm.select().from(executions).where(eq(executions.id, id)).get()
  }

  listExecutions(): Execution[] {
    return this.orm.select().from(executions).orderBy(desc(executions.startedAt), desc(executionRowid)).all()
  }

  /**
   * Let go of a deleted workflow's runs. The workflow lives in another database
   * file, so no cascade reaches them: `keepRuns` leaves them in the history as
   * runs of no workflow, otherwise they go and their node rows cascade.
   */
  releaseWorkflow(workflowId: string, keepRuns: boolean): void {
    if (keepRuns) {
      this.orm.update(executions).set({ workflowId: null }).where(eq(executions.workflowId, workflowId)).run()
    } else {
      this.orm.delete(executions).where(eq(executions.workflowId, workflowId)).run()
    }
  }

  /**
   * Mark a node as started. Until this existed a node only appeared once it had
   * finished, so nothing — no client, no refresh, no reconnect — could tell which
   * node a run was currently executing. A quiet tool (katana runs `-silent` for
   * minutes) left the run looking idle while it worked.
   */
  startNode(input: { executionId: string; nodeId: string }): void {
    this.orm
      .insert(nodeExecutions)
      .values({
        id: newId(),
        executionId: input.executionId,
        nodeId: input.nodeId,
        status: 'running',
        startedAt: isoNow(),
      })
      .run()
  }

  recordNode(input: {
    executionId: string
    nodeId: string
    status: string
    exitCode: number | null
    stdoutPath: string | null
    stderrPath: string | null
    parsedOutput: unknown
  }): void {
    const parsed = input.parsedOutput === undefined ? null : JSON.stringify(input.parsedOutput)
    const settled = {
      status: input.status,
      exitCode: input.exitCode,
      stdoutPath: input.stdoutPath,
      stderrPath: input.stderrPath,
      parsedOutput: parsed,
      finishedAt: isoNow(),
    }
    this.orm.transaction((tx) => {
      // Settle the row startNode opened. A loop body runs the same node id many
      // times, so this claims the most recent still-running row for it rather
      // than any older one.
      const open = tx
        .select({ id: nodeExecutions.id })
        .from(nodeExecutions)
        .where(
          and(
            eq(nodeExecutions.executionId, input.executionId),
            eq(nodeExecutions.nodeId, input.nodeId),
            eq(nodeExecutions.status, 'running'),
          ),
        )
        .orderBy(desc(nodeRowid))
        .limit(1)
        .get()
      if (open !== undefined) {
        tx.update(nodeExecutions).set(settled).where(eq(nodeExecutions.id, open.id)).run()
        return
      }

      // No open row (a caller that never announced a start): insert a settled one.
      tx.insert(nodeExecutions)
        .values({
          id: newId(),
          executionId: input.executionId,
          nodeId: input.nodeId,
          startedAt: settled.finishedAt,
          ...settled,
        })
        .run()
    })
  }

  nodesFor(executionId: string): NodeExecution[] {
    return this.orm
      .select({
        id: nodeExecutions.id,
        executionId: nodeExecutions.executionId,
        nodeId: nodeExecutions.nodeId,
        status: nodeExecutions.status,
        exitCode: nodeExecutions.exitCode,
        stdoutPath: nodeExecutions.stdoutPath,
        stderrPath: nodeExecutions.stderrPath,
        parsedOutput: nodeExecutions.parsedOutput,
        startedAt: nodeExecutions.startedAt,
        finishedAt: nodeExecutions.finishedAt,
      })
      .from(nodeExecutions)
      .where(eq(nodeExecutions.executionId, executionId))
      .orderBy(asc(nodeRowid))
      .all()
      .map((row) => ({ ...row, parsedOutput: decodeOutput(row.parsedOutput) }))
  }
}
