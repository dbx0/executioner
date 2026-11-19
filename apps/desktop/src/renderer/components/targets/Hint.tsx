import type { JSX, ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js'

/**
 * The app tooltip around one element, in place of a native `title`. It brings
 * its own provider so the target components also render where no shell wraps
 * them: a side panel mounted on its own, or a test.
 */
export function Hint({ label, children }: { label: ReactNode; children: ReactElement }): JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="max-w-xs">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
