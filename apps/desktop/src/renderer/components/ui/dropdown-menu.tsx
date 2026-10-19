import type { JSX } from 'react'
import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '../../lib/utils.js'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[11rem] animate-zoom-in overflow-hidden rounded-lg border border-border bg-popover/95 p-1 shadow-floating backdrop-blur-2xl',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground outline-none',
      'data-[highlighted]:bg-surface-3 data-[highlighted]:text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator(): JSX.Element {
  return <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />
}
