import type { JSX } from 'react'
import { Copy, Pencil, Plus, Trash2, Workflow } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { cn } from '../../lib/utils.js'
import type { WorkflowSummary } from '../../api/workflows.js'
import type { SavedAgent } from '../../api/saved-agents.js'

/** A dashed "+" tile that opens a create modal. */
export function AddTile({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
    >
      <Plus className="size-5" strokeWidth={1.75} />
      {label}
    </button>
  )
}

/** One saved-workflow card with preview/duplicate/delete actions. */
export function WorkflowCard({
  workflow,
  onPreview,
  onDuplicate,
  onDelete,
}: {
  workflow: WorkflowSummary
  onPreview: () => void
  onDuplicate: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className="group relative flex min-h-[84px] flex-col rounded-lg border border-border bg-card transition-all hover:border-border-strong hover:shadow-sm">
      <button
        type="button"
        onClick={onPreview}
        className="flex min-w-0 flex-1 flex-col gap-2 p-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2">
            <Workflow className="size-4 text-muted-foreground" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{workflow.name}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Updated {new Date(workflow.updated_at).toLocaleDateString()}
        </span>
      </button>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Duplicate workflow"
          title="Duplicate workflow"
          onClick={onDuplicate}
        >
          <Copy className="size-4" strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete workflow"
          title="Delete workflow"
          onClick={onDelete}
          className="text-muted-foreground hover:text-status-error"
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  )
}

/** One saved-agent (or team) card with edit/delete actions. */
export function AgentCard({
  agent,
  onEdit,
  onDelete,
}: {
  agent: SavedAgent
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className="group relative flex min-h-[92px] flex-col rounded-lg border border-border bg-card p-3 transition-all hover:border-border-strong hover:shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2">
          <AgentIcon agent={agent.agent} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.name}</span>
        <span
          className={cn(
            // Fades out on hover so the Edit/Delete actions (same corner) don't overlap.
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-opacity group-hover:opacity-0',
            agent.scope === 'global'
              ? 'bg-surface-3 text-muted-foreground'
              : 'bg-[color-mix(in_srgb,var(--ai)_16%,transparent)] text-foreground',
          )}
        >
          {agent.scope}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{agent.description}</p>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon-sm" aria-label="Edit" title="Edit" onClick={onEdit}>
          <Pencil className="size-4" strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete"
          title="Delete"
          onClick={onDelete}
          className="text-muted-foreground hover:text-status-error"
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  )
}

/** Enough tiles to fill the first grid row or two without implying a real count. */
const SKELETON_TILES = 5

/**
 * The workflow grid while it loads. Matches WorkflowCard's tile box so the real
 * cards land in place instead of reflowing the grid around the Add tile.
 */
export function WorkflowCardsSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading workflows" className="contents">
      {Array.from({ length: SKELETON_TILES }, (_, i) => (
        <div key={i} className="flex min-h-[92px] flex-col justify-between rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 shrink-0" />
            {/* Staggered widths: a block of identical bars reads as a rendering bug. */}
            <Skeleton className="h-[13px]" style={{ width: `${String(70 - (i % 3) * 15)}%` }} />
          </div>
          <Skeleton className="h-[11px] w-1/3" />
        </div>
      ))}
    </div>
  )
}
