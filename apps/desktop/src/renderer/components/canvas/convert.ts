import type { Edge, Node } from 'reactflow'
import type { Graph } from '../../lib/graph-types.js'

export function toEngineGraph(nodes: Node[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type ?? 'unknown',
      data: (n.data ?? {}) as Record<string, unknown>,
      position: { x: n.position.x, y: n.position.y },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    })),
  }
}

export function toReactFlow(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 0, y: 0 },
      data: n.data,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    })),
  }
}
