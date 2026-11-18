import type { JSX, ReactNode } from 'react'
import { Button, type ButtonProps } from '../../components/ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import { cn } from '../../lib/utils.js'

export interface IconActionProps extends Omit<ButtonProps, 'aria-label' | 'children'> {
  /** The accessible name: what the button does, in full. */
  label: string
  /** The short hint shown on hover. */
  tooltip: string
  children: ReactNode
}

/**
 * An icon-only action in the finding pane: a round glass button with the app tooltip
 * instead of a native `title`, so the hint matches every other icon button.
 */
export function IconAction({ label, tooltip, className, children, ...props }: IconActionProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="glass"
          size="icon-sm"
          aria-label={label}
          className={cn('size-[30px] text-muted-foreground hover:text-foreground', className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
