import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils.js'

export interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  className?: string
}

/**
 * The app checkbox. A custom control rather than a native input, so it takes
 * the glass tokens in every theme instead of the platform's own box. It is a
 * `button` with `role="checkbox"`: a click or Space toggles it (Space is the
 * button's own activation key), and a wrapping `label` still names and
 * toggles it because a button is a labelable element.
 */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, disabled = false, id, 'aria-label': ariaLabel, className }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      // Enter activates a button but must not toggle a checkbox (it would also
      // swallow a form's submit key).
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault()
      }}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] border outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-glass-border bg-glass hover:bg-glass-strong',
        className,
      )}
    >
      {checked && <Check aria-hidden className="size-3" strokeWidth={3} />}
    </button>
  ),
)
Checkbox.displayName = 'Checkbox'
