import { cn } from '../../lib/utils.js'

/**
 * A pickable row in one of the page's lists (a tool, a target, a run): a soft
 * pill that takes the brighter glass fill when it is the selected one.
 */
export const listRowClass = (selected: boolean): string =>
  cn(
    'rounded-[9px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
    selected ? 'bg-glass-active text-foreground' : 'text-muted-foreground hover:bg-glass-strong hover:text-foreground',
  )

/** The small caps heading over a group of rows or a section. */
export const SECTION_LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'
