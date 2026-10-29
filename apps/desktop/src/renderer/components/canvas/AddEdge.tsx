import type { JSX } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow'
import { useCanvas, type CanvasActions } from './CanvasContext.js'
import { edgeRunStyle } from './edge-run-style.js'

/**
 * Custom reactflow edge that renders a faint "+" affordance at its midpoint.
 * Clicking the affordance opens the insert-between node picker for this edge.
 */
export function AddEdge(props: EdgeProps): JSX.Element {
  const { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, style, markerEnd, data } = props
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // The wired-in CanvasContext exposes onInsertBetween; treat it defensively so a
  // no-op or not-yet-wired handler never crashes the edge.
  const canvas = useCanvas() as CanvasActions & { onInsertBetween?: (edgeId: string) => void }

  // exactOptionalPropertyTypes: only forward style/markerEnd when actually present.
  const lit = edgeRunStyle((data as { sourceStatus?: string } | undefined)?.sourceStatus)
  const mergedStyle = lit ? { ...style, ...lit } : style
  const baseEdgeProps = {
    ...(mergedStyle ? { style: mergedStyle } : {}),
    ...(markerEnd ? { markerEnd } : {}),
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} {...baseEdgeProps} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute pointer-events-auto"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            type="button"
            title="Insert node"
            aria-label="Insert node"
            className="flex size-5 items-center justify-center rounded-full border border-border bg-popover text-xs text-muted-foreground opacity-30 transition-opacity hover:border-ring hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={(e) => {
              e.stopPropagation()
              canvas.onInsertBetween?.(id)
            }}
          >
            +
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const graphEdgeTypes = { default: AddEdge }
