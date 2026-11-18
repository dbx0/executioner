import type { Edge, Node } from 'reactflow'
import { unifyStartNodes } from '@exe/graph'
import type { GraphNodeData } from '../../components/canvas/GraphNodes.js'
import { toReactFlow } from '../../components/canvas/convert.js'
import type { CatalogEntry } from '../../lib/node-catalog.js'
import type { Graph } from '../../lib/graph-types.js'

export interface CanvasGraph {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
}

/**
 * Rebuild React Flow nodes/edges from a saved engine graph, resolving each
 * node's catalog entry (kind, label, availableParams) and its params. Shared
 * by workflow load, file import and an applied assistant proposal.
 */
export function hydrateGraph(graph: Graph, catalog: CatalogEntry[]): CanvasGraph {
  // A file exported before the schedule and on_create triggers were retired
  // still names them; they read as the Start node.
  const flow = toReactFlow(unifyStartNodes(graph as Parameters<typeof unifyStartNodes>[0]) as Graph)
  const nodes: Node<GraphNodeData>[] = flow.nodes.map((n) => {
    const entry = catalog.find((e) => e.type === n.type)
    const kind = entry?.kind ?? 'tool'
    return {
      ...n,
      type: kind,
      data: {
        label: entry?.label ?? n.type ?? 'node',
        nodeType: n.type ?? 'unknown',
        kind,
        category: entry?.category ?? 'tool',
        availableParams: entry?.params ?? [],
        params: (n.data as { params?: Record<string, unknown> })?.params ?? (n.data as Record<string, unknown>) ?? {},
      },
    }
  })
  return { nodes, edges: flow.edges as Edge[] }
}

/**
 * Serialize the canvas to the engine graph shape. The engine reads a node's
 * params as top-level `data` keys, so only user params are emitted as `data`.
 */
export function buildGraph(nodes: Node<GraphNodeData>[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      data: n.data.params,
      position: n.position,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    })),
  }
}

/** The file name a workflow exports under: its name as a slug. */
export function exportFileName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug === '' ? 'workflow' : slug}.json`
}
