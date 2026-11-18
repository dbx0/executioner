import type { JSX } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * The toggle switch. Controlled: `checked` + `onCheckedChange`. On is the
 * primary fill (the same white pill as the primary action); off is a glass
 * track with a hairline, and the knob takes whichever tone reads against it.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-transparent bg-primary' : 'border-glass-border bg-glass-strong',
      )}
    >
      <span
        className={cn(
          'inline-block size-3.5 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-[18px] bg-primary-foreground' : 'translate-x-0.5 bg-muted-foreground',
        )}
      />
    </button>
  )
}
