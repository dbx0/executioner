/**
 * Class recipes shared by every floating surface (select, dropdown, context
 * menu, tooltip, dialog), so a menu and a listbox cannot drift apart.
 *
 * `bg-popover` is deliberately solid: a menu sits over arbitrary content, and
 * text under a translucent menu makes its rows hard to read.
 */
export const POPOVER_SURFACE =
  'rounded-[14px] border border-glass-border bg-popover text-popover-foreground shadow-floating'

/** One row inside a floating list: a pill that fills when the pointer or keyboard is on it. */
export const POPOVER_ITEM =
  'flex cursor-pointer select-none items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-[13px] outline-none ' +
  'data-[highlighted]:bg-glass-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:shrink-0'

/** The small caps heading over a group of rows. */
export const POPOVER_LABEL = 'px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'

/** The hairline between groups of rows. */
export const POPOVER_SEPARATOR = 'mx-1 my-1 h-px bg-glass-border'
