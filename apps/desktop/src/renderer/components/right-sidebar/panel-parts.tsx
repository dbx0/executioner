import type { HTMLAttributes, JSX, KeyboardEvent, ReactNode } from 'react'
import { ChevronRight, RotateCw } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { Skeleton } from '../ui/skeleton.js'
import { Spinner } from '../ui/spinner.js'
import { Tip } from '../ui/tip.js'

/**
 * The pieces every right-sidebar panel is built from. The shell wraps a panel in
 * a floating glass surface, so nothing here paints a background or an outer
 * border: a panel is a compact header over rows.
 */

/** Small caps, muted: a panel title and a section label read the same. */
const CAPTION = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'

/** The panel frame: a compact header (title, then the panel's actions) over its body. */
export function Panel({
  title,
  meta,
  actions,
  children,
}: {
  title: string
  /** A count beside the title ("508"). */
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 pl-3.5 pr-2">
        <h2 className={cn(CAPTION, 'truncate')}>{title}</h2>
        {meta !== undefined && <span className="mr-auto shrink-0 text-[11px] tabular-nums text-tertiary-foreground">{meta}</span>}
        {actions}
      </header>
      {children}
    </section>
  )
}

/**
 * The refresh button of a panel header. While the fetch it started is in flight
 * it shows the spinner and cannot be pressed again.
 */
export function PanelRefresh({
  label,
  loading,
  disabled = false,
  onClick,
}: {
  /** The accessible name, also shown as the tooltip ("Refresh targets"). */
  label: string
  loading: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <Tip label={label}>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        aria-label={label}
        aria-busy={loading}
        disabled={disabled || loading}
        onClick={onClick}
      >
        {loading ? <Spinner size="sm" /> : <RotateCw className="size-3.5" strokeWidth={1.75} />}
      </Button>
    </Tip>
  )
}

/** A section label inside a panel body, with an optional count pill. */
export function PanelSection({ children, count }: { children: ReactNode; count?: number | undefined }): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-2 pb-1 pt-3">
      <h3 className={CAPTION}>{children}</h3>
      {count !== undefined && count > 0 && (
        <span className="rounded-control bg-glass-strong px-1.5 text-[10px] tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  )
}

/** A one-line note: an empty state, or an error. `fill` centers it in the whole panel body. */
export function PanelNote({
  children,
  tone = 'muted',
  fill = false,
}: {
  children: ReactNode
  tone?: 'muted' | 'error'
  fill?: boolean
}): JSX.Element {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'px-3.5 py-1 text-[12px]',
        tone === 'error' ? 'text-status-error' : 'text-muted-foreground',
        fill && 'grid min-h-0 flex-1 place-items-center text-center',
      )}
    >
      {children}
    </p>
  )
}

/** Rows standing in for a list that has not arrived, shaped like `PanelRow`. */
export function PanelRowsSkeleton({
  label,
  rows = 6,
  detail = false,
}: {
  /** Announced once for the whole group ("Loading executions"). */
  label: string
  rows?: number
  /** Match rows that carry a second line. */
  detail?: boolean
}): JSX.Element {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-0.5 px-2 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex items-center gap-2 px-2', detail ? 'h-10' : 'h-7')}>
          <Skeleton className="size-3.5 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-2.5', i % 3 === 0 ? 'w-3/5' : i % 3 === 1 ? 'w-4/5' : 'w-1/2')} />
            {detail && <Skeleton className="h-2 w-2/5" />}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface PanelRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Tree depth; each level indents the row. */
  depth?: number
  selected?: boolean
  /** The expander slot of a tree row: open, closed, or an empty slot that keeps leaves aligned. Omit for a flat list. */
  chevron?: 'open' | 'closed' | 'none' | undefined
  /** The leading glyph: a file icon, a status dot, a status letter. */
  icon?: ReactNode
  label: ReactNode
  /** A second, quieter line under the label. */
  detail?: ReactNode
  /** Right-aligned extras: a count, a date, a status. */
  trailing?: ReactNode
}

/**
 * One pill row of a panel list or tree. A row with an `onClick` is a button
 * (focusable, Enter and Space activate it); one without is a plain line.
 */
export function PanelRow({
  depth = 0,
  selected = false,
  chevron,
  icon,
  label,
  detail,
  trailing,
  className,
  onClick,
  onKeyDown,
  ...rest
}: PanelRowProps): JSX.Element {
  const interactive = onClick !== undefined
  const activate = (e: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(e)
    if (e.defaultPrevented || !interactive || e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.currentTarget.click()
    }
  }
  return (
    <div
      {...rest}
      {...(interactive ? { role: 'button', tabIndex: 0, 'aria-current': selected ? ('true' as const) : undefined } : {})}
      onClick={onClick}
      onKeyDown={activate}
      // Depth is data, not a fixed step Tailwind can name.
      style={{ paddingLeft: `${String(8 + depth * 12)}px` }}
      className={cn(
        'flex items-center gap-1.5 pr-2.5 text-[12.5px] outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        // A one-line row is a pill; a two-line row would bulge as one, so it takes a card radius.
        detail === undefined ? 'h-7 rounded-control' : 'min-h-10 rounded-xl py-1',
        selected ? 'bg-glass-active text-foreground' : 'text-muted-foreground',
        interactive && 'cursor-pointer',
        interactive && !selected && 'hover:bg-glass-strong hover:text-foreground',
        className,
      )}
    >
      {chevron !== undefined && (
        <ChevronRight
          aria-hidden
          className={cn('size-3 shrink-0 transition-transform', chevron === 'open' && 'rotate-90', chevron === 'none' && 'invisible')}
          strokeWidth={2}
        />
      )}
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {detail !== undefined && <span className="truncate text-[11px] text-tertiary-foreground">{detail}</span>}
      </span>
      {trailing}
    </div>
  )
}
