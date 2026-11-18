import type { JSX } from 'react'
import { CircleHelp, Ban } from 'lucide-react'
import type { TargetNode } from '../../api/targets.js'
import { cn } from '../../lib/utils.js'
import { Hint } from './Hint.js'

export type ScopeStatus = 'in' | 'out' | 'unknown'
export type ScopeFilter = ScopeStatus | 'all'

/**
 * Marks an asset that is not plainly inside the engagement.
 *
 * Nothing is drawn for an in-scope asset: that is the normal case, and a badge
 * on every row would be noise that teaches you to stop reading badges. The two
 * exceptions are kept visually distinct because they mean different things:
 * `unknown` is a question nobody has answered, `out` is a decision someone made.
 * The reason shows on hover, and is the badge's accessible name.
 */
export function ScopeBadge({ status, reason }: { status: ScopeStatus; reason: string }): JSX.Element | null {
  if (status === 'in') return null

  const excluded = status === 'out'
  const Icon = excluded ? Ban : CircleHelp

  const badge = (
    <span
      aria-label={reason}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-[0.05em]',
        excluded ? 'text-status-error' : 'text-attention',
      )}
    >
      <Icon className="size-3" strokeWidth={2} />
      {excluded ? 'Out of scope' : 'Unscoped'}
    </span>
  )
  return reason === '' ? badge : <Hint label={reason}>{badge}</Hint>
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
