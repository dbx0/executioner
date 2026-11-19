import type { JSX, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * The frame every page view sits in: a toolbar row over a body, on the window
 * ground, with the gutter that keeps floating panels off the window edge.
 */
export function Page({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={cn('flex h-full min-w-0 flex-col pb-panel pl-1 pr-panel', className)}>{children}</div>
}

export interface PageToolbarProps {
  /** The page name, shown first. Omit when a tab strip takes its place. */
  title?: ReactNode
  /** A count or short status beside the title. */
  meta?: ReactNode
  /** Controls after the title: filters, search, segmented switches. */
  children?: ReactNode
  /** Controls pinned to the right: the page's actions. */
  actions?: ReactNode
  className?: string
}

/**
 * The page toolbar. It replaces the old title bar, so the row itself drags the
 * window; anything interactive inside must carry `app-no-drag` (Button,
 * Segmented and Input already sit in no-drag wrappers here).
 */
export function PageToolbar({ title, meta, children, actions, className }: PageToolbarProps): JSX.Element {
  return (
    <header className={cn('app-drag flex h-[52px] shrink-0 items-center gap-2 px-1', className)}>
      {title !== undefined && <h1 className="truncate pl-1 text-[15px] font-semibold tracking-[-0.01em]">{title}</h1>}
      {meta !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
      {children !== undefined && <div className="app-no-drag flex min-w-0 items-center gap-2">{children}</div>}
      {actions !== undefined && <div className="app-no-drag ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/** The page body under the toolbar: lays floating panels out with the shared gap. */
export function PageBody({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={cn('flex min-h-0 flex-1 gap-panel', className)}>{children}</div>
}
