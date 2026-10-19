import type { JSX } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * A near-monochrome toggle switch. Controlled: `checked` + `onCheckedChange`.
 * On = filled foreground track; off = muted track; the knob rides the theme
 * background so it reads on both states.
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
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        checked ? 'bg-foreground' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
