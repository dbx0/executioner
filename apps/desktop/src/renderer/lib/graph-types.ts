export interface GraphNode {
  id: string
  type: string
  data: Record<string, unknown>
  position?: { x: number; y: number }
}
export interface GraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}
export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
