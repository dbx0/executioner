import type { JSX, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/** The small caps label over a form field, shared by every modal form. */
export function FieldLabel({
  children,
  htmlFor,
  className,
}: {
  children: ReactNode
  htmlFor?: string | undefined
  className?: string
}): JSX.Element {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground', className)}
    >
      {children}
    </label>
  )
}

/** The quiet helper line under a field. */
export function FieldHint({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <p className={cn('mt-1.5 text-[11.5px] text-muted-foreground', className)}>{children}</p>
}
