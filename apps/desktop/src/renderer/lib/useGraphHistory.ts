import { useCallback, useRef, useState } from 'react'
import type { Edge, Node } from 'reactflow'

export interface GraphSnapshot<T = unknown> {
  nodes: Node<T>[]
  edges: Edge[]
}

export interface GraphHistory<T = unknown> {
  /** Push a new snapshot. Coalesces with the previous push if within coalesceMs. */
  record: (nodes: Node<T>[], edges: Edge[]) => void
  /** Step back; returns the snapshot to apply, or null if nothing to undo. */
  undo: () => GraphSnapshot<T> | null
  /** Step forward; returns the snapshot to apply, or null if nothing to redo. */
  redo: () => GraphSnapshot<T> | null
  /** Replace the baseline and clear both stacks (e.g. when loading a workflow). */
  reset: (nodes: Node<T>[], edges: Edge[]) => void
  canUndo: boolean
  canRedo: boolean
}

/** Shallow-clone the live arrays so later mutation cannot corrupt stored history. */
function snapshot<T>(nodes: Node<T>[], edges: Edge[]): GraphSnapshot<T> {
  return { nodes: nodes.map((n) => ({ ...n })), edges: edges.map((e) => ({ ...e })) }
}

/** Clone a stored snapshot on the way out so callers cannot alias history. */
function clone<T>(snap: GraphSnapshot<T>): GraphSnapshot<T> {
  return { nodes: snap.nodes.map((n) => ({ ...n })), edges: snap.edges.map((e) => ({ ...e })) }
}

export function useGraphHistory<T = unknown>(opts?: { coalesceMs?: number }): GraphHistory<T> {
  const coalesceMs = opts?.coalesceMs ?? 350

  const past = useRef<GraphSnapshot<T>[]>([])
  const present = useRef<GraphSnapshot<T> | null>(null)
  const future = useRef<GraphSnapshot<T>[]>([])
  const lastRecordAt = useRef(0)

  // `version` exists only to trigger a re-render so canUndo/canRedo recompute.
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const record = useCallback(
    (nodes: Node<T>[], edges: Edge[]) => {
      const next = snapshot(nodes, edges)

      if (present.current === null) {
        // First ever record establishes the baseline; nothing lands on past.
        // Leave lastRecordAt at 0 so the next real edit is a fresh push, not a
        // coalesce onto the baseline (mirrors reset's documented behavior).
        present.current = next
        bump()
        return
      }

      const now = Date.now()
      const coalesce = coalesceMs > 0 && now - lastRecordAt.current < coalesceMs

      if (coalesce) {
        // Collapse a burst: replace present in place, drop any redo branch.
        present.current = next
        future.current = []
      } else {
        past.current.push(present.current)
        present.current = next
        future.current = []
      }

      lastRecordAt.current = now
      bump()
    },
    [bump, coalesceMs],
  )

  const undo = useCallback((): GraphSnapshot<T> | null => {
    if (past.current.length === 0) return null
    const prev = past.current.pop() as GraphSnapshot<T>
    if (present.current !== null) future.current.push(present.current)
    present.current = prev
    bump()
    return clone(prev)
  }, [bump])

  const redo = useCallback((): GraphSnapshot<T> | null => {
    if (future.current.length === 0) return null
    const next = future.current.pop() as GraphSnapshot<T>
    if (present.current !== null) past.current.push(present.current)
    present.current = next
    bump()
    return clone(next)
  }, [bump])

  const reset = useCallback(
    (nodes: Node<T>[], edges: Edge[]) => {
      present.current = snapshot(nodes, edges)
      past.current = []
      future.current = []
      // Reset the clock so the next record is a fresh baseline push, not a coalesce.
      lastRecordAt.current = 0
      bump()
    },
    [bump],
  )

  return {
    record,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}
