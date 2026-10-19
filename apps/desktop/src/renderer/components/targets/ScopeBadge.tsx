import type { JSX } from 'react'
import { CircleHelp, Ban } from 'lucide-react'
import type { TargetNode } from '../../api/targets.js'
import { cn } from '../../lib/utils.js'

export type ScopeStatus = 'in' | 'out' | 'unknown'
export type ScopeFilter = ScopeStatus | 'all'

/**
 * Marks an asset that is not plainly inside the engagement.
 *
 * Nothing is drawn for an in-scope asset: that is the normal case, and a badge
 * on every row would be noise that teaches you to stop reading badges. The two
 * exceptions are kept visually distinct because they mean different things —
 * `unknown` is a question nobody has answered, `out` is a decision someone made.
 */
export function ScopeBadge({ status, reason }: { status: ScopeStatus; reason: string }): JSX.Element | null {
  if (status === 'in') return null

  const excluded = status === 'out'
  const Icon = excluded ? Ban : CircleHelp

  return (
    <span
      aria-label={reason}
      title={reason}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide',
        excluded
          ? 'bg-destructive/10 text-destructive'
          : 'bg-[color-mix(in_srgb,var(--warning,#d97706)_16%,transparent)] text-[var(--warning,#d97706)]',
      )}
    >
      <Icon className="size-3" strokeWidth={2} />
      {excluded ? 'Out of scope' : 'Unscoped'}
    </span>
  )
}

/**
 * Prunes a target tree to one scope verdict, keeping any ancestor whose
 * descendant survives so a match is never orphaned out of view.
 */
export function filterTreeByScope(nodes: TargetNode[], filter: ScopeFilter): TargetNode[] {
  if (filter === 'all') return nodes
  return nodes
    .map((node) => ({ ...node, children: filterTreeByScope(node.children, filter) }))
    .filter((node) => node.scopeStatus === filter || node.children.length > 0)
}

/** Counts each verdict across the whole tree, for the filter's tallies. */
export function countByScope(nodes: TargetNode[]): Record<ScopeStatus, number> {
  const totals: Record<ScopeStatus, number> = { in: 0, out: 0, unknown: 0 }
  const walk = (list: TargetNode[]): void => {
    for (const node of list) {
      totals[node.scopeStatus] = (totals[node.scopeStatus] ?? 0) + 1
      walk(node.children)
    }
  }
  walk(nodes)
  return totals
}
