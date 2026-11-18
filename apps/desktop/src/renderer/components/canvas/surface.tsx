import type { JSX, ReactNode } from 'react'
import { GlassPanel, type GlassPanelProps } from '../ui/glass-panel.js'
import { cn } from '../../lib/utils.js'

/**
 * What a glass surface needs when it floats over the canvas instead of the bare
 * window ground: nodes and edges pass underneath, so it sits on a mostly opaque
 * raised surface and blurs the backdrop to keep its text readable. It also
 * re-enables pointer events, since the overlay layer lets clicks fall through
 * to the canvas everywhere else.
 */
export const OVER_CANVAS = 'pointer-events-auto bg-surface-1/80 backdrop-blur-2xl'

/** A floating capsule over the canvas: the toolbar groups, the zoom control, the run status. */
export const CANVAS_CAPSULE = cn('glass-capsule app-no-drag inline-flex h-9 shrink-0 items-center gap-0.5 px-1', OVER_CANVAS)

/** A glass panel floating over the canvas: the palette, the inspector, the assistant. */
export function FloatingPanel({ className, ...props }: GlassPanelProps): JSX.Element {
  return <GlassPanel className={cn(OVER_CANVAS, className)} {...props} />
}

/** The title row of a floating panel, with its controls pinned to the right. */
export function PanelHeader({
  title,
  icon,
  children,
}: {
  title: ReactNode
  icon?: ReactNode
  /** Controls on the right. */
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
      {icon}
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em]">{title}</span>
      {children}
    </div>
  )
}

/** The small caps heading over a group of fields or rows. */
export function SectionTitle({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return (
    <div className={cn('text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', className)}>
      {children}
    </div>
  )
}

/** A section inside the inspector: a hairline above and the shared padding. */
export function PanelSection({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={cn('flex flex-col gap-3 border-t border-glass-border p-3.5', className)}>{children}</div>
}

/** A template reference the user clicks to insert into a field (`{{ target.value }}`). */
export function TemplateChip({ chip, onInsert }: { chip: string; onInsert: (chip: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onInsert(chip)}
      className="rounded-control bg-glass-strong px-2 py-0.5 font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:bg-glass-active hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {chip}
    </button>
  )
}
