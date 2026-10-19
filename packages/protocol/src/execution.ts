import { z } from 'zod'

/** Lifecycle of a single node execution. No `queued`: M2 runs immediately. */
export const NodeExecutionStatus = {
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Timeout: 'timeout',
} as const

export type NodeExecutionStatus =
  (typeof NodeExecutionStatus)[keyof typeof NodeExecutionStatus]

export const nodeExecutionStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'timeout',
])
