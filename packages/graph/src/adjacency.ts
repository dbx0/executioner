import type { Graph } from './model.js'

export interface ForwardEdge {
  target: string
  sourceHandle: string | null
}

export interface ReverseEdge {
  source: string
  sourceHandle: string | null
}

export interface Adjacency {
  forward: Map<string, ForwardEdge[]>
  reverse: Map<string, ReverseEdge[]>
}

/** Forward (source -> targets) and reverse (target -> sources), both keeping sourceHandle. */
export function buildAdjacency(graph: Graph): Adjacency {
  const forward = new Map<string, ForwardEdge[]>()
  const reverse = new Map<string, ReverseEdge[]>()

  for (const edge of graph.edges) {
    const fwd = forward.get(edge.source) ?? []
    fwd.push({ target: edge.target, sourceHandle: edge.sourceHandle })
    forward.set(edge.source, fwd)

    const rev = reverse.get(edge.target) ?? []
    rev.push({ source: edge.source, sourceHandle: edge.sourceHandle })
    reverse.set(edge.target, rev)
  }

  return { forward, reverse }
}
