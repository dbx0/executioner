import type { JSX } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '../../lib/utils.js'

export interface NumberFieldProps {
  /** The field text. A string, so a half-typed or empty value survives a render. */
  value: string
  onValueChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  id?: string
  placeholder?: string
  'aria-label'?: string
  className?: string
}

const clamp = (n: number, min: number | undefined, max: number | undefined): number =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))

const STEP_BUTTON =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors ' +
  'hover:bg-glass-active hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40'

/**
 * A number input with the app's own stepper. It is a text field restricted to
 * number characters rather than `type="number"`, so the platform spin buttons
 * never show; the two buttons and the arrow keys step by `step` within
 * `min`/`max`.
 */
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  disabled = false,
  id,
  placeholder,
  'aria-label': ariaLabel,
  className,
}: NumberFieldProps): JSX.Element {
  const current = Number(value)
  const known = value.trim() !== '' && Number.isFinite(current)
  const bump = (dir: 1 | -1): void => {
    // From an empty or unreadable field the first step lands on the lower bound.
    const base = known ? current + dir * step : (min ?? 0)
    onValueChange(String(clamp(base, min, max)))
  }
  return (
    <div
      className={cn(
        'flex h-9 w-full items-center gap-1 rounded-control border border-glass-border bg-glass pl-3.5 pr-1.5 text-sm',
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        id={id}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={known ? current : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          if (/^-?\d*\.?\d*$/.test(e.target.value)) onValueChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            bump(e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease"
        disabled={disabled || (known && min !== undefined && current <= min)}
        onClick={() => bump(-1)}
        className={STEP_BUTTON}
      >
        <Minus aria-hidden className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase"
        disabled={disabled || (known && max !== undefined && current >= max)}
        onClick={() => bump(1)}
        className={STEP_BUTTON}
      >
        <Plus aria-hidden className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}
