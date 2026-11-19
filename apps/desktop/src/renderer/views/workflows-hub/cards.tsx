import type { JSX, ReactNode } from 'react'
import { Copy, Pencil, Play, Plus, Trash2, Workflow } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { Spinner } from '../../components/ui/spinner.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'
import type { WorkflowSummary } from '../../api/workflows.js'
import type { SavedAgent } from '../../api/saved-agents.js'

/** A dashed "+" tile that opens a create modal. */
export function AddTile({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed border-glass-border text-[13px] text-muted-foreground outline-none transition-colors hover:border-border-strong hover:bg-glass hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Plus className="size-5" strokeWidth={1.75} />
      {label}
    </button>
  )
}

/** The round icon badge that leads a card's title. */
function CardIcon({ children }: { children: ReactNode }): JSX.Element {
  return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-glass-strong">{children}</span>
}

/** One hover action in a card's corner: an icon pill with the app tooltip, spinning while its work runs. */
function CardAction({
  label,
  hint,
  onClick,
  pending = false,
  destructive = false,
  children,
}: {
  label: string
  /** Tooltip text when it should say more than the name. */
  hint?: string
  onClick: () => void
  pending?: boolean
  destructive?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <Tip label={hint ?? label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={pending}
        onClick={onClick}
        className={cn('text-muted-foreground', destructive ? 'hover:text-status-error' : 'hover:text-foreground')}
      >
        {pending ? <Spinner size="sm" /> : children}
      </Button>
    </Tip>
  )
}

/** The corner the hover actions sit in. It stays visible while one of them is working. */
function CardActions({ busy, children }: { busy: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      className={cn(
        'absolute right-1.5 top-1.5 flex items-center gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
        busy ? 'opacity-100' : 'opacity-0',
      )}
    >
      {children}
    </div>
  )
}

const CARD = 'group relative flex flex-col transition-colors hover:bg-glass-strong'

/** One saved-workflow card with preview/duplicate/delete actions. */
export function WorkflowCard({
  workflow,
  onPreview,
  onDuplicate,
  onDelete,
  duplicating = false,
  deleting = false,
}: {
  workflow: WorkflowSummary
  onPreview: () => void
  onDuplicate: () => void
  onDelete: () => void
  duplicating?: boolean
  deleting?: boolean
}): JSX.Element {
  return (
    <GlassPanel className={cn(CARD, 'min-h-[92px]')}>
      <button
        type="button"
        onClick={onPreview}
        className="flex min-w-0 flex-1 flex-col gap-2 rounded-panel p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <div className="flex items-center gap-2.5">
          <CardIcon>
            <Workflow className="size-4 text-muted-foreground" strokeWidth={1.75} />
          </CardIcon>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{workflow.name}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Updated {new Date(workflow.updated_at).toLocaleDateString()}
        </span>
      </button>
      <CardActions busy={duplicating || deleting}>
        <CardAction label="Duplicate workflow" onClick={onDuplicate} pending={duplicating}>
          <Copy className="size-4" strokeWidth={1.75} />
        </CardAction>
        <CardAction label="Delete workflow" onClick={onDelete} pending={deleting} destructive>
          <Trash2 className="size-4" strokeWidth={1.75} />
        </CardAction>
      </CardActions>
    </GlassPanel>
  )
}

/** One saved-agent (or team) card with run/edit/delete actions. */
export function AgentCard({
  agent,
  onRun,
  onEdit,
  onDelete,
  deleting = false,
}: {
  agent: SavedAgent
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  deleting?: boolean
}): JSX.Element {
  return (
    <GlassPanel className={cn(CARD, 'min-h-[104px] p-3')}>
      <div className="flex items-center gap-2.5">
        <CardIcon>
          <AgentIcon agent={agent.agent} className="size-4" />
        </CardIcon>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.name}</span>
        <span
          className={cn(
            // Fades out on hover so the Edit/Delete actions (same corner) don't overlap.
            'shrink-0 rounded-control px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-opacity group-focus-within:opacity-0 group-hover:opacity-0',
            deleting && 'opacity-0',
            agent.scope === 'global' ? 'bg-glass-strong text-muted-foreground' : 'bg-ai/15 text-foreground',
          )}
        >
          {agent.scope}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 flex-1 text-[11px] text-muted-foreground">{agent.description}</p>
      <div className="mt-2.5 flex items-center">
        <Tip label="Run this agent against targets">
          <Button variant="glass" size="xs" onClick={onRun} className="h-7 px-3">
            <Play className="size-3 fill-current" strokeWidth={2} />
            Run
          </Button>
        </Tip>
      </div>
      <CardActions busy={deleting}>
        <CardAction label="Edit" onClick={onEdit}>
          <Pencil className="size-4" strokeWidth={1.75} />
        </CardAction>
        <CardAction label="Delete" onClick={onDelete} pending={deleting} destructive>
          <Trash2 className="size-4" strokeWidth={1.75} />
        </CardAction>
      </CardActions>
    </GlassPanel>
  )
}

/** Enough tiles to fill the first grid row or two without implying a real count. */
const SKELETON_TILES = 5

/** Staggered title widths: a block of identical bars reads as a rendering bug. */
const SKELETON_WIDTHS = ['w-[70%]', 'w-[55%]', 'w-[40%]'] as const

/**
 * A card grid while it loads. Matches the real cards' tile box so they land in
 * place instead of reflowing the grid around the Add tile.
 */
export function CardsSkeleton({ label, className }: { label: string; className?: string }): JSX.Element {
  return (
    <div role="status" aria-label={label} className="contents">
      {Array.from({ length: SKELETON_TILES }, (_, i) => (
        <GlassPanel key={i} className={cn('flex min-h-[92px] flex-col justify-between p-3', className)}>
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className={cn('h-[13px]', SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])} />
          </div>
          <Skeleton className="h-[11px] w-1/3" />
        </GlassPanel>
      ))}
    </div>
  )
}

/** The workflow grid while it loads. */
export function WorkflowCardsSkeleton(): JSX.Element {
  return <CardsSkeleton label="Loading workflows" />
}
