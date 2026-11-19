import type { JSX, ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js'

export interface TipProps {
  /** The hint shown on hover or keyboard focus. */
  label: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** The one element the hint describes: a button, usually icon only. */
  children: ReactElement
}

/**
 * The app tooltip around a single control, in place of a native `title`. It
 * carries its own provider so a control that uses it renders on its own (inside
 * a canvas node, in a test) without relying on the shell's provider.
 */
export function Tip({ label, side = 'bottom', children }: TipProps): JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
