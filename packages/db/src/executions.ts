import { desc, eq, isNull, sql } from 'drizzle-orm'
import { isoNow, newId, type NodeExecutionStatus } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { executions, nodeExecutions } from './tables.js'

export interface CreateExecutionInput {
  targetId: string
  nodeId: string
  /** Where the run executes ('local', 'ssh', 'docker'). Defaults to 'local'. */
  backend?: string
  /** The saved connection it ran on; absent for this machine. */
  backendProfileId?: string
  /** The params the run was started with, kept so the run can be repeated. */
  params?: Record<string, unknown>
}

/**
 * One standalone run: an execution with no workflow behind it, as the Tools
 * page lists them. Carries enough to repeat the run verbatim.
 */
export interface StandaloneRun {
  id: string
  nodeId: string
  targetId: string | null
  status: string
  backend: string
  /**
   * The saved connection it ran on, or null for this machine. `backend` alone
   * cannot tell two profiles of one kind apart, so a replay reads this.
   */
  backendProfileId: string | null
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  /** The params it ran with; `{}` for rows written before params were kept. */
  params: Record<string, unknown>
}

export interface FinishExecutionInput {
  status: NodeExecutionStatus
  exitCode: number | null
  stdoutPath: string | null
  stderrPath: string | null
  /** The records the tool's output parsed into, kept as a workflow node keeps them. */
  parsed: Array<Record<string, unknown>>
  error: string | null
}

export interface ExecutionSummary {
  id: string
  status: NodeExecutionStatus
  nodeId: string
  targetId: string | null
  backend: string
  exitCode: number | null
  stdoutPath: string | null
  stderrPath: string | null
  /** How many records the run's output parsed into. */
  parsedCount: number
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

/** Decode a stored JSON object column, tolerating NULL and anything malformed. */
function decodeObject(text: string | null): Record<string, unknown> {
  if (text === null || text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** How many parsed records a stored column holds; 0 for NULL, malformed text,
 *  or a run saved before records were kept (that row held counts, not rows). */
function countRecords(text: string | null): number {
  if (text === null || text === '') return 0
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

/**
 * In milestone 2 a run is one execution plus one node_execution. The execution
 * row carries lifecycle and the node_execution row carries process detail; a
 * later milestone will fan multiple node_executions under one execution.
 */
export class ExecutionRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  create(input: CreateExecutionInput): string {
    const executionId = newId()
    const now = isoNow()
    this.orm.transaction((tx) => {
      tx.insert(executions)
        .values({
          id: executionId,
          workflowId: null,
          targetId: input.targetId,
          status: 'running',
          backend: input.backend ?? 'local',
          testMode: false,
          startedAt: now,
        })
        .run()
      tx.insert(nodeExecutions)
        .values({
          id: newId(),
          executionId,
          nodeId: input.nodeId,
          status: 'running',
          params: input.params === undefined ? null : JSON.stringify(input.params),
          backendProfileId: input.backendProfileId ?? null,
          startedAt: now,
        })
        .run()
    })
    return executionId
  }

  finish(executionId: string, input: FinishExecutionInput): void {
    const now = isoNow()
    const parsed = JSON.stringify(input.parsed)
    this.orm.transaction((tx) => {
      tx.update(executions)
        .set({ status: input.status, finishedAt: now, error: input.error })
        .where(eq(executions.id, executionId))
        .run()
      tx.update(nodeExecutions)
        .set({
          status: input.status,
          exitCode: input.exitCode,
          stdoutPath: input.stdoutPath,
          stderrPath: input.stderrPath,
          parsedOutput: parsed,
          finishedAt: now,
        })
        .where(eq(nodeExecutions.executionId, executionId))
        .run()
    })
  }

  get(executionId: string): ExecutionSummary | undefined {
    const row = this.orm
      .select({
        id: executions.id,
        status: executions.status,
        targetId: executions.targetId,
        backend: executions.backend,
        startedAt: executions.startedAt,
        finishedAt: executions.finishedAt,
        error: executions.error,
        nodeId: nodeExecutions.nodeId,
        exitCode: nodeExecutions.exitCode,
        stdoutPath: nodeExecutions.stdoutPath,
        stderrPath: nodeExecutions.stderrPath,
        parsedOutput: nodeExecutions.parsedOutput,
      })
      .from(executions)
      .innerJoin(nodeExecutions, eq(nodeExecutions.executionId, executions.id))
      .where(eq(executions.id, executionId))
      .get()
    if (row === undefined) return undefined

    const { parsedOutput, ...rest } = row
    return {
      ...rest,
      status: row.status as NodeExecutionStatus,
      parsedCount: countRecords(parsedOutput),
    }
  }

  /**
   * The most recent standalone runs, newest first. A standalone run is an
   * execution with no workflow behind it — the Tools page starts these, and
   * reads a tool's last-used params off the newest row for that node.
   */
  listStandalone(limit = 25): StandaloneRun[] {
    const rows = this.orm
      .select({
        id: executions.id,
        nodeId: nodeExecutions.nodeId,
        targetId: executions.targetId,
        status: executions.status,
        backend: executions.backend,
        backendProfileId: nodeExecutions.backendProfileId,
        startedAt: executions.startedAt,
        finishedAt: executions.finishedAt,
        exitCode: nodeExecutions.exitCode,
        params: nodeExecutions.params,
      })
      .from(executions)
      .innerJoin(nodeExecutions, eq(nodeExecutions.executionId, executions.id))
      .where(isNull(executions.workflowId))
      // rowid is SQLite's implicit insertion order, which Drizzle has no column
      // for; it breaks ties between runs started in the same millisecond.
      .orderBy(desc(executions.startedAt), desc(sql`${executions}.rowid`))
      .limit(limit)
      .all()

    return rows.map((row) => ({ ...row, params: decodeObject(row.params) }))
  }
}
