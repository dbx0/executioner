import type { JSX } from 'react'
import { cn } from '../../lib/utils.js'
import { segmentClass } from '../ui/segmented.js'

export interface ModeTab<T extends string> {
  id: T
  label: string
}

/**
 * A capsule tab strip for a modal that switches between modes of one form. It
 * is `Segmented` in looks but keeps tablist/tab roles, because the choices are
 * views of the dialog rather than values of a field.
 */
export function ModeTabs<T extends string>({
  tabs,
  value,
  onSelect,
  label,
  size = 'md',
  className,
}: {
  tabs: readonly ModeTab<T>[]
  value: T
  onSelect: (id: T) => void
  /** Names the tablist for assistive tech. */
  label: string
  size?: 'sm' | 'md'
  className?: string
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('glass-capsule inline-flex w-fit shrink-0 items-center gap-0.5 p-[3px]', size === 'md' ? 'h-8' : 'h-7', className)}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onSelect(t.id)}
          className={cn(segmentClass(value === t.id), size === 'md' ? 'h-[26px] px-3 text-xs' : 'h-[22px] px-2.5 text-[11px]')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
