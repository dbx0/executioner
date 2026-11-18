import type { CSSProperties, JSX, ReactNode } from 'react'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { cn } from '../../lib/utils.js'

export interface CardHeaderProps {
  title: string
  /** A quiet figure or timestamp beside the title. */
  note?: ReactNode
  /** A control pinned to the right, such as the lens switch on the assets card. */
  actions?: ReactNode
}

/** The title row every card on the page shares. */
export function CardHeader({ title, note, actions }: CardHeaderProps): JSX.Element {
  return (
    <header className="mb-3 flex min-h-7 items-center gap-2">
      <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
      {note !== undefined && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{note}</span>}
      {actions !== undefined && <div className={cn('shrink-0', note === undefined && 'ml-auto')}>{actions}</div>}
    </header>
  )
}

export interface AboutCardProps extends CardHeaderProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/** A floating glass card with a header and a body: one chart, one question. */
export function AboutCard({ title, note, actions, children, className, style }: AboutCardProps): JSX.Element {
  return (
    <GlassPanel asChild className={cn('flex min-w-0 flex-col p-4', className)} style={style}>
      <section>
        <CardHeader title={title} note={note} actions={actions} />
        {children}
      </section>
    </GlassPanel>
  )
}

/** A second chart inside one card, under its own smaller title row. */
export function CardSection({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="mt-4">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h3 className="truncate text-[13px] font-semibold tracking-[-0.01em]">{title}</h3>
        {note !== undefined && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{note}</span>}
      </div>
      {children}
    </div>
  )
}

/** The line a card shows in place of a chart that has nothing to draw. */
export function CardEmpty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="py-2 text-xs text-muted-foreground">{children}</p>
}

/** A footnote under a chart: what the numbers mean, or why they look wrong. */
export function CardNote({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mt-2.5 text-[11.5px] leading-snug text-muted-foreground">{children}</p>
}
