import type { JSX, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/** Shared layout primitives for the Settings sub-pages. */

/** A sub-page's title + optional one-line description, sitting above its body. */
export function PageHeading({
  title,
  description,
}: {
  title: string
  description?: string
}): JSX.Element {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description !== undefined && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
    </div>
  )
}

/** A small uppercase group label between rows within a sub-page. */
export function GroupLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="pb-2 pt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

/** A labelled setting row: label/description on the left, control on the right. */
export function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string | undefined
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-glass-border py-4">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {description !== undefined && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/**
 * An inner card on the settings pane: a list of rows, a tool, a provider. One
 * step in from the pane's own panel radius, so nested surfaces read as nested.
 */
export function SettingsCard({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={cn('overflow-hidden rounded-[14px] border border-glass-border bg-glass', className)}>{children}</div>
}

/** The quiet one-liner a section shows when it has nothing to list or cannot load. */
export function SettingsNote({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>
}

/** A small capsule for a category, kind or count beside a name. */
export function Tag({ mono = false, children }: { mono?: boolean; children: ReactNode }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-glass-strong px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground',
        mono && 'font-mono normal-case tracking-normal',
      )}
    >
      {children}
    </span>
  )
}

const PILL_TONES = {
  neutral: 'bg-glass-strong text-muted-foreground',
  success: 'bg-[color-mix(in_srgb,var(--status-success)_16%,transparent)] text-status-success',
  danger: 'bg-[color-mix(in_srgb,var(--destructive)_16%,transparent)] text-destructive',
} as const

/** A status capsule: an icon (or spinner) and a word, tinted by what it reports. */
export function StatusPill({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof PILL_TONES
  icon?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', PILL_TONES[tone])}>
      {icon}
      {children}
    </span>
  )
}

/** The version chip: a separate badge, shown only when a version is known. */
export function VersionChip({ version }: { version: string }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-full border border-glass-border px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      {version}
    </span>
  )
}

/** The rounded tile that holds a card's leading icon or brand mark. */
export function IconTile({ size = 'md', children }: { size?: 'sm' | 'md'; children: ReactNode }): JSX.Element {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-[10px] bg-glass-strong', size === 'md' ? 'size-9' : 'size-8')}>
      {children}
    </span>
  )
}
