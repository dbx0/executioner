import type { Graph } from './model.js'
import { topologicalSort } from './topo.js'

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

export function validateGraph(graph: Graph): ValidationResult {
  const errors: string[] = []
  const ids = new Set<string>()

  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`)
    ids.add(node.id)
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.source)) errors.push(`edge ${edge.id} references missing source ${edge.source}`)
    if (!ids.has(edge.target)) errors.push(`edge ${edge.id} references missing target ${edge.target}`)
  }

  if (errors.length === 0) {
    try {
      topologicalSort(graph)
    } catch {
      errors.push('graph contains a cycle')
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
