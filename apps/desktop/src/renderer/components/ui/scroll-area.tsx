import * as React from 'react'
import { cn } from '../../lib/utils.js'

/** Lightweight scroll container using the sleek custom scrollbar recipe. */
export const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('scrollbar-sleek overflow-y-auto', className)} {...props}>
      {children}
    </div>
  ),
)
ScrollArea.displayName = 'ScrollArea'
