import type { JSX, ReactNode } from 'react'
import { Copy, Play, Plus, Trash2 } from 'lucide-react'
import type { NodeKind } from '../../lib/node-catalog.js'
import { Tip } from '../ui/tip.js'
import { cn } from '../../lib/utils.js'
import { useCanvas } from './CanvasContext.js'
import { CANVAS_CAPSULE } from './surface.js'

function NodeAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <Tip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        // `nodrag` keeps a press on the button from starting a node drag.
        className={cn(
          'nodrag flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors',
          'hover:bg-glass-active hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className,
        )}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        {children}
      </button>
    </Tip>
  )
}

/** The capsule of per-node actions shown above a hovered or selected node. */
export function NodeActions({ id, kind }: { id: string; kind: NodeKind }): JSX.Element {
  const { onDuplicate, onDelete, onAppend, onRunNode } = useCanvas()
  return (
    <div className={cn(CANVAS_CAPSULE, 'h-8')}>
      {kind === 'tool' && (
        <NodeAction label="Run this node" onClick={() => onRunNode(id)} className="hover:text-status-success">
          <Play className="size-3.5" strokeWidth={1.75} />
        </NodeAction>
      )}
      {kind !== 'stop' && (
        <NodeAction label="Append node" onClick={() => onAppend(id)}>
          <Plus className="size-3.5" strokeWidth={1.75} />
        </NodeAction>
      )}
      <NodeAction label="Duplicate" onClick={() => onDuplicate(id)}>
        <Copy className="size-3.5" strokeWidth={1.75} />
      </NodeAction>
      <NodeAction label="Delete" onClick={() => onDelete(id)} className="hover:text-status-error">
        <Trash2 className="size-3.5" strokeWidth={1.75} />
      </NodeAction>
    </div>
  )
}
