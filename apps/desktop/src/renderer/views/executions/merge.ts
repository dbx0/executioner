import type { NodeOutputRow } from '../../api/executions.js'

/** A live stdout/stderr frame for one node of a run. */
export interface LogFrame {
  nodeId: string
  type: string
  data: string
}

/**
 * Build one row per node of a run from the two sources that describe it.
 *
 * Persisted evidence is authoritative. Live frames fill in a node the refetch
 * hasn't caught yet — and `doneStatus` (the terminal status off the event bus)
 * settles it, because the engine publishes a node's 'done' event BEFORE writing
 * its row, so a node that finished can otherwise render as "running".
 *
 * Every node is kept, including ones that produced nothing: a node dropping off
 * the list is exactly how a silent failure goes unnoticed.
 */
export function mergeNodeRows(
  persisted: NodeOutputRow[],
  log: LogFrame[],
  doneStatus: Map<string, string>,
): NodeOutputRow[] {
  const byId = new Map<string, NodeOutputRow>()
  for (const p of persisted) byId.set(p.nodeId, { ...p })

  // Once a node has evidence on disk, the stream would only duplicate it.
  const hasEvidence = new Set(persisted.filter((p) => p.stdout !== '' || p.stderr !== '').map((p) => p.nodeId))

  for (const frame of log) {
    if (hasEvidence.has(frame.nodeId)) continue
    const row = byId.get(frame.nodeId) ?? {
      nodeId: frame.nodeId,
      status: doneStatus.get(frame.nodeId) ?? 'running',
      exitCode: null,
      stdout: '',
      stderr: '',
      parsed: null,
    }
    if (frame.type === 'stderr') row.stderr += frame.data
    else row.stdout += frame.data
    byId.set(frame.nodeId, row)
  }

  for (const [nodeId, status] of doneStatus) {
    const row = byId.get(nodeId)
    if (row === undefined) {
      // Announced but nothing persisted or streamed yet — a silent tool that has
      // only just started. Show it rather than leaving the run looking idle.
      byId.set(nodeId, { nodeId, status, exitCode: null, stdout: '', stderr: '', parsed: null })
    } else if (row.status === 'running') {
      // A node that finished must not keep the placeholder it was created with.
      row.status = status
    }
  }

  return [...byId.values()]
}
