import type { Graph } from './model.js'

/**
 * Kahn's algorithm. Ties break by the node's original index so the order is
 * deterministic across runs, which keeps executions reproducible. Throws on a
 * cycle rather than looping.
 */
export function topologicalSort(graph: Graph): string[] {
  const order = graph.nodes.map((n) => n.id)
  const index = new Map(order.map((id, i) => [id, i]))
  const indegree = new Map<string, number>(order.map((id) => [id, 0]))
  const outgoing = new Map<string, string[]>(order.map((id) => [id, []]))

  for (const edge of graph.edges) {
    if (!indegree.has(edge.target) || !outgoing.has(edge.source)) continue
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)!.push(edge.target)
  }

  const ready = order.filter((id) => indegree.get(id) === 0)
  const sorted: string[] = []

  while (ready.length > 0) {
    ready.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0))
    const id = ready.shift()!
    sorted.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) ready.push(next)
    }
  }

  if (sorted.length !== order.length) {
    throw new Error('graph contains a cycle')
  }
  return sorted
}
