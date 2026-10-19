import { useCallback, useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Edge, Node } from 'reactflow'
import type { GraphNodeData } from '../../components/canvas/GraphNodes.js'
import type { GraphHistory } from '../../lib/useGraphHistory.js'

/**
 * Undo/redo wiring for the workflow canvas: records structural graph edits into
 * the history stack, exposes undo/redo callbacks, and binds the keyboard
 * shortcuts. Extracted verbatim from WorkflowEditor; the caller owns the
 * `history` instance and the `applyingHistory` guard ref because both are also
 * used by load/import/reset paths.
 */
export function useUndoRedo({
  nodes,
  edges,
  setNodes,
  setEdges,
  history,
  applyingHistory,
}: {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  setNodes: Dispatch<SetStateAction<Node<GraphNodeData>[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  history: GraphHistory<GraphNodeData>
  applyingHistory: MutableRefObject<boolean>
}): { undo: () => void; redo: () => void } {
  // Record structural graph edits (node/edge add/remove, position, params) into
  // undo history. Keyed on a signature that excludes live status/output so
  // run-status paints never pollute the history stack. Rapid changes coalesce.
  const graphSig = useMemo(
    () =>
      JSON.stringify({
        n: nodes.map((n) => [n.id, n.type, Math.round(n.position.x), Math.round(n.position.y), n.data.params]),
        e: edges.map((e) => [e.id, e.source, e.target, e.sourceHandle ?? null]),
      }),
    [nodes, edges],
  )
  useEffect(() => {
    if (applyingHistory.current) {
      applyingHistory.current = false
      return
    }
    history.record(nodes, edges)
    // Depend only on the structural signature; nodes/edges/history are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSig])

  const undo = useCallback(() => {
    const snap = history.undo()
    if (snap === null) return
    applyingHistory.current = true
    setNodes(snap.nodes)
    setEdges(snap.edges)
  }, [history, setNodes, setEdges, applyingHistory])

  const redo = useCallback(() => {
    const snap = history.redo()
    if (snap === null) return
    applyingHistory.current = true
    setNodes(snap.nodes)
    setEdges(snap.edges)
  }, [history, setNodes, setEdges, applyingHistory])

  // Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z (or Ctrl+Y) redo. Ignore while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey && !e.ctrlKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return { undo, redo }
}
