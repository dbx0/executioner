import type { Edge, Node } from 'reactflow'

const START_X = 80
const START_Y = 120
const GAP_X = 260
const GAP_Y = 140

/**
 * Arrange reactflow nodes into a clean left-to-right layered (topological) layout.
 *
 * Layers are assigned by longest-path layering via Kahn's algorithm: roots
 * (indegree 0) sit at layer 0 and every other node lands one column right of its
 * deepest parent. Within a layer, nodes are ordered by the average rank of their
 * parents (roots first, stable on input order). Nodes trapped in a cycle are
 * appended deterministically to the last layer. Inputs are never mutated: new node
 * objects are returned with only `position` changed.
 */
export function layoutGraph<T>(nodes: Node<T>[], edges: Edge[]): Node<T>[] {
  if (nodes.length === 0) return []

  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<string, string[]>()
  const parents = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const n of nodes) {
    children.set(n.id, [])
    parents.set(n.id, [])
    indegree.set(n.id, 0)
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    children.get(e.source)!.push(e.target)
    parents.get(e.target)!.push(e.source)
    indegree.set(e.target, indegree.get(e.target)! + 1)
  }

  // Longest-path layering via Kahn's algorithm.
  const layer = new Map<string, number>()
  const queue: string[] = []
  for (const n of nodes) {
    if (indegree.get(n.id) === 0) {
      layer.set(n.id, 0)
      queue.push(n.id)
    }
  }
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]!
    const base = layer.get(id)!
    for (const child of children.get(id)!) {
      const current = layer.get(child)
      if (current === undefined || base + 1 > current) layer.set(child, base + 1)
      const remaining = indegree.get(child)! - 1
      indegree.set(child, remaining)
      if (remaining === 0) queue.push(child)
    }
  }

  // Any node left unresolved is part of a cycle: park it on the last layer.
  let maxLayer = -1
  for (const value of layer.values()) if (value > maxLayer) maxLayer = value
  const cycleLayer = Math.max(0, maxLayer)
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, cycleLayer)
  }

  // Bucket nodes per layer, preserving input order as the stable base.
  const buckets: string[][] = []
  for (const n of nodes) {
    const l = layer.get(n.id)!
    ;(buckets[l] ??= []).push(n.id)
  }

  // Order each layer left to right so parent ranks are known before children.
  const rank = new Map<string, number>()
  for (let l = 0; l < buckets.length; l++) {
    const bucket = buckets[l] ?? []
    const keyed = bucket.map((id, i) => {
      const ranked = parents
        .get(id)!
        .map((p) => rank.get(p))
        .filter((r): r is number => r !== undefined)
      const avg = ranked.length > 0 ? ranked.reduce((a, b) => a + b, 0) / ranked.length : -1
      return { id, avg, i }
    })
    keyed.sort((a, b) => (a.avg !== b.avg ? a.avg - b.avg : a.i - b.i))
    const ordered = keyed.map((k) => k.id)
    ordered.forEach((id, idx) => rank.set(id, idx))
    buckets[l] = ordered
  }

  const position = new Map<string, { x: number; y: number }>()
  for (let l = 0; l < buckets.length; l++) {
    const bucket = buckets[l] ?? []
    bucket.forEach((id, idx) => {
      position.set(id, { x: START_X + l * GAP_X, y: START_Y + idx * GAP_Y })
    })
  }

  return nodes.map((n) => ({ ...n, position: position.get(n.id)! }))
}
