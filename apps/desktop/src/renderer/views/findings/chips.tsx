import type { JSX } from 'react'
import { statusLabel } from '../../api/findings.js'
import { cn } from '../../lib/utils.js'

/**
 * Severity carries the weight here, so it gets the colour; status is the
 * quieter, factual half of the pair. Both read at a glance in a long list.
 *
 * The tints are written as `color-mix` on the token: the theme colors are plain
 * `var()` values, which Tailwind cannot apply an opacity modifier to, so a class
 * like `bg-status-error/20` compiles to nothing and the chip would not paint.
 */
interface SeverityTone {
  /** The severity's color as text. */
  text: string
  /** The same color as a solid fill, for a dot. */
  dot: string
  /** A translucent wash of it, for a chip or pill background. */
  tint: string
}

const INFO_TONE: SeverityTone = { text: 'text-muted-foreground', dot: 'bg-muted-foreground', tint: 'bg-glass-strong' }

const SEVERITY_TONE: Record<string, SeverityTone> = {
  critical: {
    text: 'text-status-error',
    dot: 'bg-status-error',
    tint: 'bg-[color-mix(in_srgb,var(--status-error)_16%,transparent)]',
  },
  high: {
    text: 'text-attention',
    dot: 'bg-attention',
    tint: 'bg-[color-mix(in_srgb,var(--attention)_16%,transparent)]',
  },
  medium: {
    text: 'text-status-running',
    dot: 'bg-status-running',
    tint: 'bg-[color-mix(in_srgb,var(--status-running)_16%,transparent)]',
  },
  low: {
    text: 'text-[color-mix(in_srgb,var(--status-running)_55%,var(--muted-foreground))]',
    dot: 'bg-[color-mix(in_srgb,var(--status-running)_55%,var(--muted-foreground))]',
    tint: 'bg-[color-mix(in_srgb,var(--status-running)_9%,transparent)]',
  },
  info: INFO_TONE,
}

function severityTone(severity: string): SeverityTone {
  return SEVERITY_TONE[severity.toLowerCase()] ?? INFO_TONE
}

/** Text color class for a severity. */
export function severityTextClass(severity: string): string {
  return severityTone(severity).text
}

/** Tinted background plus text color for a severity, for a chip or a pill. */
export function severityPillClass(severity: string): string {
  const tone = severityTone(severity)
  return `${tone.tint} ${tone.text}`
}

/** Tinted background plus text color for a status pill. Only the two decided states get color. */
export function statusPillClass(status: string): string {
  if (status === 'confirmed') return 'bg-[color-mix(in_srgb,var(--status-error)_16%,transparent)] text-status-error'
  if (status === 'fixed') return 'bg-[color-mix(in_srgb,var(--status-success)_16%,transparent)] text-status-success'
  return status === 'open' ? 'bg-glass-strong text-foreground' : 'bg-glass-strong text-muted-foreground'
}

const STATUS_TONE: Record<string, string> = {
  open: 'text-foreground',
  confirmed: 'text-status-error',
  false_positive: 'text-muted-foreground line-through',
  discarded: 'text-muted-foreground italic',
  fixed: 'text-status-success',
}

/** "high" to "High". Severities are stored lowercase and shown capitalised in controls. */
export function severityLabel(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1)
}

export function SeverityChip({ severity, className }: { severity: string; className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 rounded-control px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
        severityPillClass(severity),
        className,
      )}
    >
      {severity}
    </span>
  )
}

/** A severity as a bare colored dot. Decorative: pair it with the severity's name. */
export function SeverityDot({ severity, className }: { severity: string; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('size-1.5 shrink-0 rounded-full', severityTone(severity).dot, className)}
    />
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
