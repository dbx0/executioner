import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { addEdge, type Connection, type Edge, type Node, type ReactFlowInstance } from 'reactflow'
import type { GraphNodeData } from '../../components/canvas/GraphNodes.js'
import type { CatalogEntry } from '../../lib/node-catalog.js'
import { layoutGraph } from '../../lib/autolayout.js'

/** Suffix for new node ids. Module-wide so ids stay unique across editor mounts. */
let counter = 0

/** The open node picker (edge insert or node append), positioned in screen space. */
export interface PickerState {
  mode: 'insert' | 'append'
  refId: string
  x: number
  y: number
}

type Position = { x: number; y: number }

/** Build a fresh graph node from a catalog entry (shared by palette add, drop, edge-insert and node-append). */
function makeNode(entry: CatalogEntry, position: Position): Node<GraphNodeData> {
  counter += 1
  return {
    id: `${entry.type}-${counter}`,
    type: entry.kind,
    position,
    data: {
      label: entry.label,
      nodeType: entry.type,
      kind: entry.kind,
      category: entry.category,
      availableParams: entry.params,
      params: {},
    },
  }
}

/**
 * With a node gone, bridge its neighbours when it sat inline (exactly one in
 * and one out edge) so the chain stays connected. Returns null when it did not.
 */
function bridgeAround(eds: Edge[], id: string): Edge[] | null {
  const incoming = eds.filter((e) => e.target === id)
  const outgoing = eds.filter((e) => e.source === id)
  const inEdge = incoming[0]
  const outEdge = outgoing[0]
  if (incoming.length !== 1 || outgoing.length !== 1 || inEdge === undefined || outEdge === undefined) return null
  const remaining = eds.filter((e) => e.source !== id && e.target !== id)
  return addEdge(
    { id: `bridge-${inEdge.source}-${outEdge.target}`, source: inEdge.source, target: outEdge.target, animated: true },
    remaining,
  )
}

/**
 * Every structural edit the canvas offers: add (click, drop, insert on an edge,
 * append after a node), duplicate, delete, connect, arrange and param edits.
 * The caller owns the node/edge state; this hook only derives the handlers.
 */
export function useGraphEditing({
  nodes,
  edges,
  setNodes,
  setEdges,
  setSelectedId,
  catalog,
  rfRef,
}: {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  setNodes: Dispatch<SetStateAction<Node<GraphNodeData>[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setSelectedId: Dispatch<SetStateAction<string | undefined>>
  catalog: CatalogEntry[]
  rfRef: MutableRefObject<ReactFlowInstance | null>
}) {
  const [picker, setPicker] = useState<PickerState | null>(null)

  const addNode = useCallback(
    (entry: CatalogEntry, position?: Position) => {
      const at = position ?? { x: 160 + (counter % 6) * 40, y: 80 + (counter % 8) * 48 }
      setNodes((cur) => cur.concat(makeNode(entry, at)))
    },
    [setNodes],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const raw = e.dataTransfer.getData('application/exe-node')
      if (raw === '' || rfRef.current === null) return
      let parsed: { type?: string }
      try {
        parsed = JSON.parse(raw) as { type?: string }
      } catch {
        return
      }
      const entry = catalog.find((c) => c.type === parsed.type)
      if (entry === undefined) return
      addNode(entry, rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    },
    [catalog, addNode, rfRef],
  )

  // Remove a node; if it sat inline, bridge its neighbours. Otherwise just drop its edges.
  const onDelete = useCallback(
    (id: string) => {
      setEdges((eds) => bridgeAround(eds, id) ?? eds.filter((e) => e.source !== id && e.target !== id))
      setNodes((cur) => cur.filter((n) => n.id !== id))
      setSelectedId((cur) => (cur === id ? undefined : cur))
    },
    [setEdges, setNodes, setSelectedId],
  )

  const onDuplicate = useCallback(
    (id: string) => {
      setNodes((cur) => {
        const src = cur.find((n) => n.id === id)
        if (src === undefined) return cur
        counter += 1
        const cloneId = `${src.data.nodeType}-${counter}`
        const clone: Node<GraphNodeData> = {
          ...src,
          id: cloneId,
          position: { x: src.position.x + 40, y: src.position.y + 40 },
          selected: true,
          data: { ...src.data, params: { ...src.data.params } },
        }
        setSelectedId(cloneId)
        return cur.map((n) => (n.id === id ? { ...n, selected: false } : n)).concat(clone)
      })
    },
    [setNodes, setSelectedId],
  )

  // A keyboard delete: React Flow drops the node and its edges itself, so only
  // the bridge for a single inline node is added here.
  const onNodesDelete = useCallback(
    (deleted: Node<GraphNodeData>[]) => {
      if (deleted.length !== 1 || deleted[0] === undefined) return
      const id = deleted[0].id
      setEdges((eds) => bridgeAround(eds, id) ?? eds)
    },
    [setEdges],
  )

  const arrange = useCallback(() => {
    setNodes(layoutGraph(nodes, edges))
    requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.2, duration: 250 }))
  }, [nodes, edges, setNodes, rfRef])

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)), [setEdges])

  // Open the node picker over an edge's midpoint to insert a node splitting it.
  const onInsertBetween = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId)
      if (edge === undefined) return
      const src = nodes.find((n) => n.id === edge.source)
      const tgt = nodes.find((n) => n.id === edge.target)
      let at: Position = { x: 240, y: 200 }
      if (src !== undefined && tgt !== undefined && rfRef.current !== null) {
        at = rfRef.current.flowToScreenPosition({
          x: (src.position.x + tgt.position.x) / 2 + 75,
          y: (src.position.y + tgt.position.y) / 2 + 20,
        })
      }
      setPicker({ mode: 'insert', refId: edgeId, x: at.x, y: at.y })
    },
    [edges, nodes, rfRef],
  )

  // Open the node picker beside a node to append a downstream node.
  const onAppend = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      let at: Position = { x: 240, y: 200 }
      if (node !== undefined && rfRef.current !== null) {
        at = rfRef.current.flowToScreenPosition({ x: node.position.x + 220, y: node.position.y + 20 })
      }
      setPicker({ mode: 'append', refId: nodeId, x: at.x, y: at.y })
    },
    [nodes, rfRef],
  )

  // Commit a picker choice: insert (rewire A to new to B) or append (node to new).
  const onPickNode = useCallback(
    (entry: CatalogEntry) => {
      const p = picker
      if (p === null) return
      if (p.mode === 'insert') {
        const edge = edges.find((e) => e.id === p.refId)
        if (edge === undefined) {
          setPicker(null)
          return
        }
        const src = nodes.find((n) => n.id === edge.source)
        const tgt = nodes.find((n) => n.id === edge.target)
        const pos =
          src !== undefined && tgt !== undefined
            ? { x: (src.position.x + tgt.position.x) / 2, y: (src.position.y + tgt.position.y) / 2 }
            : { x: 240, y: 200 }
        const node = makeNode(entry, pos)
        setNodes((cur) => cur.concat(node))
        setEdges((eds) => {
          const rest = eds.filter((e) => e.id !== p.refId)
          const inEdge: Edge = {
            id: `e-${edge.source}-${node.id}`,
            source: edge.source,
            target: node.id,
            animated: true,
            ...(edge.sourceHandle !== null && edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
          }
          const outEdge: Edge = { id: `e-${node.id}-${edge.target}`, source: node.id, target: edge.target, animated: true }
          return rest.concat(inEdge, outEdge)
        })
      } else {
        const node = nodes.find((n) => n.id === p.refId)
        const pos = node !== undefined ? { x: node.position.x + 220, y: node.position.y } : { x: 240, y: 200 }
        const created = makeNode(entry, pos)
        setNodes((cur) => cur.concat(created))
        setEdges((eds) =>
          addEdge({ id: `e-${p.refId}-${created.id}`, source: p.refId, target: created.id, animated: true }, eds),
        )
      }
      setPicker(null)
    },
    [picker, edges, nodes, setNodes, setEdges],
  )

  const setParam = useCallback(
    (nodeId: string, key: string, value: unknown) =>
      setNodes((cur) =>
        cur.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n,
        ),
      ),
    [setNodes],
  )

  const closePicker = useCallback(() => setPicker(null), [])

  return {
    picker,
    closePicker,
    addNode,
    onDragOver,
    onDrop,
    onDelete,
    onDuplicate,
    onNodesDelete,
    arrange,
    onConnect,
    onInsertBetween,
    onAppend,
    onPickNode,
    setParam,
  }
}
