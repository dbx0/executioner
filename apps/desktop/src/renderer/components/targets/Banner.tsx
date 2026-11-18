import type { JSX, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.js'

export interface BannerProps {
  /** `error` for a failed action, `notice` for the result of one that worked. */
  tone: 'error' | 'notice'
  children: ReactNode
  /** Shows a dismiss button when given. */
  onDismiss?: () => void
  className?: string
}

/** A one-line message strip above a panel: what just failed, or what just happened. */
export function Banner({ tone, children, onDismiss, className }: BannerProps): JSX.Element {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-control px-3.5 py-1.5 text-xs',
        tone === 'error'
          ? 'bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] text-status-error'
          : 'glass-capsule text-muted-foreground',
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="ml-auto shrink-0 rounded-control opacity-60 outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
