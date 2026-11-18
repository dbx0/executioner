import type { JSX, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Accessible name when the label is not plain text (an icon). */
  ariaLabel?: string
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Names the group for assistive tech ("Severity", "View mode"). */
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/** The fill a selected segment (or any selected pill inside a capsule) takes. */
export const segmentClass = (active: boolean): string =>
  cn(
    'app-no-drag inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium outline-none transition-colors',
    'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
    active ? 'bg-glass-active text-foreground' : 'text-muted-foreground hover:text-foreground',
  )

/**
 * A capsule of mutually exclusive choices: a filter, a view-mode switch, a small
 * tab set. One of them is always selected.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: SegmentedProps<T>): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('glass-capsule app-no-drag inline-flex shrink-0 items-center gap-0.5 p-[3px]', size === 'md' ? 'h-8' : 'h-7', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(segmentClass(active), size === 'md' ? 'h-[26px] px-3 text-xs' : 'h-[22px] px-2.5 text-[11px]')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
