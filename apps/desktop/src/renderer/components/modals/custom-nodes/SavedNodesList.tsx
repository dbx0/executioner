import type { JSX } from 'react'
import { Boxes, Trash2, Pencil } from 'lucide-react'
import type { CustomNode } from '../../../api/custom-nodes.js'
import { cn } from '../../../lib/utils.js'

/** The left rail: every saved custom node, with edit and delete affordances. */
export function SavedNodesList({
  nodes,
  editingId,
  onEdit,
  onRemove,
}: {
  nodes: CustomNode[]
  editingId: string | undefined
  onEdit: (n: CustomNode) => void
  onRemove: (id: string) => void
}): JSX.Element {
  return (
    <div className="w-52 shrink-0 overflow-y-auto scrollbar-sleek border-r border-border p-2">
      <div className="px-1 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Saved</div>
      {nodes.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">No custom nodes yet. Create one on the right.</p>
      ) : (
        nodes.map((n) => (
          <div
            key={n.id}
            className={cn(
              'group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
              editingId === n.id
                ? 'selected-surface'
                : 'hover:bg-surface-2',
            )}
          >
            <Boxes className="size-4 text-muted-foreground" />
            <button type="button" className="flex min-w-0 flex-1 flex-col items-start" onClick={() => onEdit(n)}>
              <span className="w-full truncate text-left">{n.name}</span>
              <span className="w-full truncate text-left text-[11px] text-muted-foreground">{n.id}</span>
            </button>
            <button
              type="button"
              aria-label="Edit"
              className="opacity-0 group-hover:opacity-100"
              onClick={() => onEdit(n)}
            >
              <Pencil className="size-3.5 text-muted-foreground hover:text-foreground" />
            </button>
            <button
              type="button"
              aria-label="Delete"
              className="opacity-0 group-hover:opacity-100"
              onClick={() => onRemove(n.id)}
            >
              <Trash2 className="size-3.5 text-muted-foreground hover:text-status-error" />
            </button>
          </div>
        ))
      )}
    </div>
  )
}
