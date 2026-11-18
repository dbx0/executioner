import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * The surface of every row in the sidebar: a pill that brightens on hover and
 * takes the selected glass fill when it is the current thing. The 10px radius
 * is the mock's row shape, tighter than a control pill so stacked rows read as a list. Exported as a
 * class builder for the rows that are a `div` wrapping two buttons.
 */
export function sidebarRowClass(active: boolean, className?: string): string {
  return cn(
    'group flex h-8 w-full shrink-0 items-center gap-2.5 rounded-[10px] px-2 text-[13px] font-medium outline-none transition-colors',
    'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
    active ? 'bg-glass-active text-foreground' : 'text-muted-foreground hover:bg-glass-strong hover:text-foreground',
    className,
  )
}

export interface SidebarRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The row is the current page or session. */
  active?: boolean
}

/** One sidebar row as a button: a nav item, a session, a run. */
export const SidebarRow = React.forwardRef<HTMLButtonElement, SidebarRowProps>(
  ({ active = false, className, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={sidebarRowClass(active, className)} {...props} />
  ),
)
SidebarRow.displayName = 'SidebarRow'
