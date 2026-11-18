import type { JSX } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils.js'

const SIZES = { xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-6' } as const

export interface SpinnerProps {
  size?: keyof typeof SIZES
  className?: string
}

/** The one spinner. Decorative on its own: label the thing that is loading, not the icon. */
export function Spinner({ size = 'md', className }: SpinnerProps): JSX.Element {
  return <Loader2 aria-hidden className={cn('shrink-0 animate-spin', SIZES[size], className)} strokeWidth={2} />
}

/**
 * A centered spinner with a label, for a panel whose content has not arrived and
 * has no row shape to skeleton. Prefer a `Skeleton` layout when the shape is known.
 */
export function LoadingState({ label, className }: { label: string; className?: string }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex h-full min-h-24 w-full flex-col items-center justify-center gap-2.5 text-[13px] text-muted-foreground', className)}
    >
      <Spinner size="lg" />
      <span>{label}</span>
    </div>
  )
}
