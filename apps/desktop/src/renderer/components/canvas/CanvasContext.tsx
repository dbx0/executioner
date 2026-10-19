import { createContext, useContext } from 'react'

/** Node/edge-level actions surfaced by the canvas (wired by WorkflowsView). */
export interface CanvasActions {
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  /** Open the node picker to insert a node in the middle of an edge (A→new→B). */
  onInsertBetween: (edgeId: string) => void
  /** Open the node picker to append a downstream node after this node. */
  onAppend: (nodeId: string) => void
  /** Run just this node against the current run target via the single-node path. */
  onRunNode: (id: string) => void
}

export const CanvasContext = createContext<CanvasActions>({
  onDuplicate: () => {},
  onDelete: () => {},
  onInsertBetween: () => {},
  onAppend: () => {},
  onRunNode: () => {},
})

export function useCanvas(): CanvasActions {
  return useContext(CanvasContext)
}
