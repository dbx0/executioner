import type { NodeOutputRow } from '../../api/executions.js'

/**
 * Fill in a row from the engine's output endpoint. An engine older than a field
 * omits it rather than sending null, so the UI must not assume every key is
 * present — a missing exit code is "unknown" and stays silent, while an explicit
 * null means the process never started.
 */
export interface SafeRow {
  nodeId: string
  status: string
  stdout: string
  stderr: string
  /** number = real code, null = never started, undefined = engine didn't say. */
  exitCode: number | null | undefined
  /** The parsed rows themselves, for rendering as a table rather than as JSON. */
  parsedValue: unknown
  /** How many rows were parsed, for a one-glance summary on the card. */
  parsedCount: number
}

/**
 * Pretty-print parsed rows, tolerating anything the node emitted. Kept out of
 * `safeRow` on purpose: only the full-output modal shows this text, while
 * `safeRow` runs for every card on every render — and a run streaming events
 * re-renders those cards once per frame, where stringifying thousands of parsed
 * rows each time is pure waste.
 */
export function formatParsed(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value) && value.length === 0) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** How many rows a node parsed, without touching their contents. */
function countParsed(value: unknown): number {
  if (value === null || value === undefined) return 0
  return Array.isArray(value) ? value.length : 1
}

export function safeRow(row: NodeOutputRow): SafeRow {
  const raw = row as Partial<NodeOutputRow>
  return {
    nodeId: raw.nodeId ?? '(unnamed node)',
    status: raw.status ?? 'unknown',
    stdout: raw.stdout ?? '',
    stderr: raw.stderr ?? '',
    exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : raw.exitCode === null ? null : undefined,
    parsedValue: raw.parsed ?? null,
    parsedCount: countParsed(raw.parsed),
  }
}
