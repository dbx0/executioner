import type { JSX } from 'react'
import { cn } from '../../lib/utils.js'
import { segmentClass } from '../ui/segmented.js'
import type { ScopeFilter, ScopeStatus } from './ScopeBadge.js'

const LABEL: Record<ScopeStatus, string> = { in: 'In scope', unknown: 'Unscoped', out: 'Out of scope' }
const ORDER: readonly ScopeStatus[] = ['in', 'unknown', 'out']

export interface ScopeFilterTabsProps {
  counts: Record<ScopeStatus, number>
  total: number
  value: ScopeFilter
  onChange: (value: ScopeFilter) => void
}

/**
 * The scope filter capsule across the top of the target list. It earns its place only when the verdicts actually
 * differ: on an engagement whose boundary is settled every asset is in scope,
 * and a control offering to hide nothing is just another thing to read past.
 */
export function ScopeFilterTabs({ counts, total, value, onChange }: ScopeFilterTabsProps): JSX.Element | null {
  const present = ORDER.filter((key) => counts[key] > 0)
  if (present.length < 2) return null
  const tabs: { key: ScopeFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: total },
    ...present.map((key) => ({ key, label: LABEL[key], count: counts[key] })),
  ]
  return (
    <div
      role="tablist"
      aria-label="Filter by scope"
      className="mx-2.5 mt-2.5 flex shrink-0 items-center gap-0.5 rounded-control bg-[color-mix(in_srgb,var(--background)_45%,transparent)] p-[3px]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(segmentClass(value === tab.key), 'h-[26px] min-w-0 flex-1 px-2 text-xs')}
        >
          {tab.label}
          <span className="tabular-nums opacity-60">{tab.count}</span>
        </button>
      ))}
    </div>
  )
}
