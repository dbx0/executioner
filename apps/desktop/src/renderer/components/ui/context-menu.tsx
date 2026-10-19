import type { JSX } from 'react'
import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils.js'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger
export const ContextMenuSub = ContextMenuPrimitive.Sub

/**
 * Shared panel styling. `bg-popover` is deliberately solid: the config maps
 * `popover` to a bare `var(--popover)` with no `<alpha-value>` slot, so an
 * opacity modifier like `bg-popover/95` compiles to nothing at all and leaves
 * the panel with no background whatsoever.
 */
const PANEL =
  'z-[70] min-w-[11rem] animate-zoom-in rounded-lg border border-border bg-popover p-1 text-[13px] text-foreground shadow-floating'

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content ref={ref} className={cn(PANEL, className)} {...props} />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = 'ContextMenuContent'

/**
 * A submenu's panel. Portalled like the root content, so it is never clipped by
 * — nor does it add scrollbars to — whatever it happens to be nested inside.
 */
export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent ref={ref} sideOffset={sideOffset} className={cn(PANEL, className)} {...props} />
  </ContextMenuPrimitive.Portal>
))
ContextMenuSubContent.displayName = 'ContextMenuSubContent'

const ITEM =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none ' +
  'data-[highlighted]:bg-surface-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0'

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive = false, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      ITEM,
      destructive ? 'text-destructive [&_svg]:text-destructive' : 'text-foreground [&_svg]:text-muted-foreground',
      className,
    )}
    {...props}
  />
))
ContextMenuItem.displayName = 'ContextMenuItem'

export const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(ITEM, 'text-foreground data-[state=open]:bg-surface-3 [&_svg]:text-muted-foreground', className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" strokeWidth={2} />
  </ContextMenuPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger'

export function ContextMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', className)}
      {...props}
    />
  )
}

export function ContextMenuSeparator(): JSX.Element {
  return <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />
}
