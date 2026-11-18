import type { JSX } from 'react'
import { Boxes, Trash2, Pencil } from 'lucide-react'
import type { CustomNode } from '../../../api/custom-nodes.js'
import { cn } from '../../../lib/utils.js'
import { Skeleton } from '../../ui/skeleton.js'
import { Spinner } from '../../ui/spinner.js'

const ROW_ACTION =
  'grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 outline-none transition-colors ' +
  'hover:bg-glass-active focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover:opacity-100 ' +
  'disabled:pointer-events-none'

/** The left rail: every saved custom node, with edit and delete affordances. */
export function SavedNodesList({
  nodes,
  editingId,
  removingId,
  onEdit,
  onRemove,
}: {
  /** Null while the list is still loading. */
  nodes: CustomNode[] | null
  editingId: string | undefined
  /** The node whose delete is in flight. */
  removingId: string | null
  onEdit: (n: CustomNode) => void
  onRemove: (id: string) => void
}): JSX.Element {
  return (
    <div className="scrollbar-sleek w-56 shrink-0 overflow-y-auto border-r border-glass-border p-2">
      <div className="px-2 pb-1.5 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Saved</div>
      {nodes === null ? (
        <div role="status" aria-label="Loading custom nodes" className="flex flex-col gap-1.5 px-1">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 rounded-[10px]" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">No custom nodes yet. Create one on the right.</p>
      ) : (
        nodes.map((n) => (
          <div
            key={n.id}
            className={cn(
              'group flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-[13px] transition-colors',
              editingId === n.id ? 'bg-glass-active' : 'hover:bg-glass-strong',
            )}
          >
            <Boxes className="size-4 shrink-0 text-muted-foreground" />
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-start rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => onEdit(n)}
            >
              <span className="w-full truncate text-left">{n.name}</span>
              <span className="w-full truncate text-left text-[11px] text-muted-foreground">{n.id}</span>
            </button>
            <button type="button" aria-label="Edit" className={cn(ROW_ACTION, 'hover:text-foreground')} onClick={() => onEdit(n)}>
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete"
              disabled={removingId === n.id}
              className={cn(ROW_ACTION, 'hover:text-status-error', removingId === n.id && 'opacity-100')}
              onClick={() => onRemove(n.id)}
            >
              {removingId === n.id ? <Spinner size="sm" /> : <Trash2 className="size-3.5" />}
            </button>
          </div>
        ))
      )}
    </div>
  )
}
