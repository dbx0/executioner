import type { Project } from '@exe/project'
import type { EventBus } from '../../../transport/events.js'
import type { RunRepository } from '@exe/db'
import type { Sender } from './http-client.js'
import type { Resolver } from './http-guard.js'

/** The slice of the executor's dependencies the built-in node handlers need. */
export interface BuiltinNodeDeps {
  project: Project
  bus: EventBus
  store: RunRepository
  /** The port the engine's API listens on, which http_request and notify never call. */
  enginePort?: () => number
  /** How http_request and notify resolve hostnames. Absent → the system resolver. */
  resolveHost?: Resolver
  /** How http_request and notify put one vetted hop on the wire. Absent → node:http(s). */
  sendHttp?: Sender
}

/** Emit the running/done lifecycle + persist a built-in node's result. */
export function finishBuiltin(
  deps: BuiltinNodeDeps,
  executionId: string,
  nodeId: string,
  status: 'succeeded' | 'failed',
  output: string,
  rows: Array<Record<string, unknown>>,
  stdoutPath: string | null,
  stderrPath: string | null = null,
): void {
  deps.store.recordNode({
    executionId,
    nodeId,
    status,
    exitCode: status === 'succeeded' ? 0 : 1,
    stdoutPath,
    stderrPath,
    parsedOutput: rows,
  })
  deps.bus.publish({ type: 'done', executionId, nodeId, data: status })
}
