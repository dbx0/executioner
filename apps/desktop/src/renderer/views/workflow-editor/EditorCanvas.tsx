import type { JSX } from 'react'
import { useMemo, type MutableRefObject } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from 'reactflow'
import '../../components/canvas/flow-styles.js'
import { graphNodeTypes, NewNodeIdsContext, type GraphNodeData } from '../../components/canvas/GraphNodes.js'
import { CanvasContext, type CanvasActions } from '../../components/canvas/CanvasContext.js'
import { graphEdgeTypes } from '../../components/canvas/AddEdge.js'

const DELETE_KEYS = ['Backspace', 'Delete']
const PRO_OPTIONS = { hideAttribution: true }

/**
 * The React Flow surface itself: the dot grid, the nodes and the edges, with
 * the node-level actions and the "just added" ids provided to the node
 * components through context. Everything floating over it lives in the editor.
 */
export function EditorCanvas({
  nodes,
  edges,
  newNodeIds,
  actions,
  rfRef,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodesDelete,
  onDrop,
  onDragOver,
  onSelect,
}: {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  newNodeIds: ReadonlySet<string>
  actions: CanvasActions
  rfRef: MutableRefObject<ReactFlowInstance | null>
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: (c: Connection) => void
  onNodesDelete: (deleted: Node<GraphNodeData>[]) => void
  onDrop: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  /** A node was clicked (its id) or the empty pane was (undefined). */
  onSelect: (id: string | undefined) => void
}): JSX.Element {
  // Edges leaving a succeeded node light up. Only those edges are rebuilt, and
  // only at render time, so the stored edges (history, save) stay untouched.
  const displayEdges = useMemo(() => {
    const statusById = new Map(nodes.map((n) => [n.id, n.data.status]))
    return edges.map((e) => {
      const sourceStatus = statusById.get(e.source)
      if (sourceStatus !== 'success') return e
      return { ...e, data: { ...(e.data as object | undefined), sourceStatus } }
    })
  }, [nodes, edges])

  return (
    <CanvasContext.Provider value={actions}>
      <NewNodeIdsContext.Provider value={newNodeIds}>
        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          nodeTypes={graphNodeTypes}
          edgeTypes={graphEdgeTypes}
          onInit={(inst) => (rfRef.current = inst)}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={(_, n) => onSelect(n.id)}
          onPaneClick={() => onSelect(undefined)}
          deleteKeyCode={DELETE_KEYS}
          fitView
          proOptions={PRO_OPTIONS}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
        </ReactFlow>
      </NewNodeIdsContext.Provider>
    </CanvasContext.Provider>
  )
}
