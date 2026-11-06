import type { Graph } from './graph-types.js'

/**
 * Trigger a client-side download of `data` serialized as pretty JSON. Uses a
 * Blob + object URL + a transient anchor so it works without a server round-trip.
 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function isGraph(value: unknown): value is Graph {
  if (typeof value !== 'object' || value === null) return false
  const graph = value as { nodes?: unknown; edges?: unknown }
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges)
}

/**
 * Parse and loosely validate a workflow export file. Returns the workflow name
 * (when present) and its graph, or `null` when the text is not JSON or lacks a
 * graph with `nodes`/`edges` arrays.
 */
export function parseWorkflowFile(text: string): { name?: string; graph: Graph } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as { name?: unknown; graph?: unknown }
  if (!isGraph(record.graph)) return null
  return typeof record.name === 'string'
    ? { name: record.name, graph: record.graph }
    : { graph: record.graph }
}
