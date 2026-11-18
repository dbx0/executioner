import type { JSX, ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'

/**
 * The app tooltip around one element. The page uses it wherever a native
 * `title` used to explain a control or a chart mark, so the hint looks like the
 * rest of the app instead of the operating system.
 */
export function Hint({ label, children }: { label: ReactNode; children: ReactElement }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
