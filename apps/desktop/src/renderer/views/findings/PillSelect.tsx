import type { JSX } from 'react'
import { Select, type SelectProps } from '../../components/ui/select.js'
import { cn } from '../../lib/utils.js'

/**
 * The app Select with a capsule trigger sized to its value: the pill menu the
 * Findings page uses for the status filter and for a finding's severity and
 * status. `className` carries the pill's fill, so a value can tint its own pill.
 */
export function PillSelect({ className, ...props }: SelectProps): JSX.Element {
  return (
    <Select
      {...props}
      className={cn(
        'app-no-drag h-[30px] w-auto shrink-0 gap-1.5 rounded-control border-0 bg-glass-strong px-3 text-xs font-semibold transition-colors',
        className,
      )}
    />
  )
}
