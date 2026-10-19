import type { JSX } from 'react'
import { statusLabel } from '../../api/findings.js'
import { cn } from '../../lib/utils.js'

/**
 * Severity carries the weight here, so it gets the colour; status is the
 * quieter, factual half of the pair. Both read at a glance in a long list.
 */
const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-status-error/20 text-status-error',
  high: 'bg-status-error/12 text-status-error',
  medium: 'bg-attention/15 text-attention',
  low: 'bg-status-running/15 text-status-running',
  info: 'bg-surface-3 text-muted-foreground',
}

const STATUS_TONE: Record<string, string> = {
  open: 'text-foreground',
  confirmed: 'text-status-error',
  false_positive: 'text-muted-foreground line-through',
  discarded: 'text-muted-foreground italic',
  fixed: 'text-status-success',
}

export function SeverityChip({ severity, className }: { severity: string; className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
        SEVERITY_TONE[severity.toLowerCase()] ?? SEVERITY_TONE.info,
        className,
      )}
    >
      {severity}
    </span>
  )
}

export function StatusChip({ status, className }: { status: string; className?: string }): JSX.Element {
  return (
    <span className={cn('shrink-0 text-[11px] font-medium', STATUS_TONE[status] ?? 'text-muted-foreground', className)}>
      {statusLabel(status)}
    </span>
  )
}

/** Where a finding came from, in one word. */
export function SourceChip({ source }: { source: string }): JSX.Element {
  return <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-muted-foreground">{source}</span>
}
