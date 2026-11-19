import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * The multi-line text field: the Input surface with a softer radius (a pill
 * does not survive more than one line) and the sleek scrollbar. It does not
 * resize by drag; give it `rows` or a height class.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'scrollbar-sleek flex w-full resize-none rounded-[14px] border border-glass-border bg-glass px-3.5 py-2 text-sm outline-none',
        'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
