import type { Graph, GraphEdge, GraphNode } from './model.js'

/** The one node type that marks where a workflow begins. */
export const START_NODE_TYPE = 'manual'

/**
 * Trigger node types from before actions existed. They looked as if they armed
 * a schedule or a reaction, and never did: when a workflow runs is decided by an
 * action, outside the graph. They are read as a plain start node.
 */
const LEGACY_TRIGGER_TYPES = new Set(['schedule', 'on_create'])

/** How far left of the nodes it leads into a start node added here is placed. */
const START_GAP = 280

/**
 * Rewrite the old `schedule` and `on_create` trigger nodes as the start node,
 * dropping the settings they carried (an interval, a target kind) since nothing
 * reads them. Returns the same graph object when there is nothing to rewrite.
 */
export function unifyStartNodes(graph: Graph): Graph {
  if (!graph.nodes.some((node) => LEGACY_TRIGGER_TYPES.has(node.type))) return graph
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (LEGACY_TRIGGER_TYPES.has(node.type) ? { ...node, type: START_NODE_TYPE, data: {} } : node)),
  }
}

const unusedId = (base: string, taken: Set<string>): string => {
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`
}

const placeOf = (node: GraphNode): { x: number; y: number } | undefined => {
  const position = (node as { position?: unknown }).position
  if (typeof position !== 'object' || position === null) return undefined
  const { x, y } = position as { x?: unknown; y?: unknown }
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined
}

/**
 * Make sure a workflow has a start node. A graph without one still runs, which
 * is exactly why a generated graph so often lacks it: nothing fails. So it is
 * added here rather than asked for: one start node, wired to every node that
 * nothing else leads into. Old trigger nodes count as a start (see
 * {@link unifyStartNodes}). An empty graph is left empty.
 */
export function withStartNode(graph: Graph): Graph {
  const unified = unifyStartNodes(graph)
  if (unified.nodes.length === 0 || unified.nodes.some((node) => node.type === START_NODE_TYPE)) return unified

  const reached = new Set(unified.edges.map((edge) => edge.target))
  const entries = unified.nodes.filter((node) => !reached.has(node.id))
  const id = unusedId('start', new Set(unified.nodes.map((node) => node.id)))

  const places = entries.map(placeOf).filter((p): p is { x: number; y: number } => p !== undefined)
  const position =
    places.length === 0
      ? undefined
      : {
          x: Math.min(...places.map((p) => p.x)) - START_GAP,
          y: Math.round(places.reduce((sum, p) => sum + p.y, 0) / places.length),
        }

  const edgeIds = new Set(unified.edges.map((edge) => edge.id))
  const edges: GraphEdge[] = entries.map((entry) => {
    const edgeId = unusedId(`${id}-${entry.id}`, edgeIds)
    edgeIds.add(edgeId)
    return { id: edgeId, source: id, target: entry.id, sourceHandle: null }
  })

  const start: GraphNode = { id, type: START_NODE_TYPE, data: {}, ...(position === undefined ? {} : { position }) }
  return { ...unified, nodes: [start, ...unified.nodes], edges: [...unified.edges, ...edges] }
}
