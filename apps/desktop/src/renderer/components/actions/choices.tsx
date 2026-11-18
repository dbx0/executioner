import type { JSX, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/** The fill a chosen option card takes: brighter glass, never a colored accent. */
const optionClass = (selected: boolean): string =>
  cn(
    'rounded-[14px] border border-glass-border text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
    selected ? 'bg-glass-active text-foreground' : 'bg-glass text-muted-foreground hover:bg-glass-strong',
  )

export function Legend({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>
}

export function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-1 text-[12px] text-muted-foreground">{children}</div>
}

/** One of two side-by-side choices; the chosen one carries the selected surface. */
export function Choice({
  selected,
  onSelect,
  icon,
  children,
}: {
  selected: boolean
  onSelect: () => void
  icon: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(optionClass(selected), 'flex h-11 items-center gap-2.5 px-3.5 text-[13px] font-medium')}
    >
      {icon}
      {children}
    </button>
  )
}

/** A radio row with a title and a line under it. */
export function ScopeOption({
  selected,
  onSelect,
  disabled = false,
  title,
  hint,
}: {
  selected: boolean
  onSelect: () => void
  disabled?: boolean
  title: string
  hint: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(optionClass(selected), 'flex w-full flex-col gap-0.5 px-3.5 py-2.5')}
    >
      <span className="text-[13px] font-medium text-foreground">{title}</span>
      <span className="text-[12px] text-muted-foreground">{hint}</span>
    </button>
  )
}
