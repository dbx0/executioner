import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * A native checkbox tinted to the app's foreground token so it matches the
 * near-monochrome design instead of the browser default blue.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded border border-input [accent-color:var(--foreground)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Checkbox.displayName = 'Checkbox'
