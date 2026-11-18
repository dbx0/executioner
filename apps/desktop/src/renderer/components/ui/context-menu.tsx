import type { JSX } from 'react'
import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { POPOVER_ITEM, POPOVER_LABEL, POPOVER_SEPARATOR, POPOVER_SURFACE } from './surface.js'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger
export const ContextMenuSub = ContextMenuPrimitive.Sub

/** The menu panel: the shared popover surface, above every dialog. */
const PANEL = cn(POPOVER_SURFACE, 'z-[80] min-w-[11rem] animate-zoom-in p-1 text-[13px] text-foreground')

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
 * whatever it happens to be nested inside, and never adds scrollbars to it.
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

const ITEM = cn(POPOVER_ITEM, 'w-full [&_svg]:size-3.5')

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
    className={cn(ITEM, 'text-foreground data-[state=open]:bg-glass-strong [&_svg]:text-muted-foreground', className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" strokeWidth={2} />
  </ContextMenuPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger'

export function ContextMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={cn(POPOVER_LABEL, className)} {...props} />
  )
}

export function ContextMenuSeparator(): JSX.Element {
  return <ContextMenuPrimitive.Separator className={POPOVER_SEPARATOR} />
}
