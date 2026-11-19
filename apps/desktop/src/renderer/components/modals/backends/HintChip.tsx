import type { JSX, ReactNode } from 'react'
import { cn } from '../../../lib/utils.js'
import { Tip } from '../../ui/tip.js'

/**
 * A one-click suggestion under a field: an SSH host from the config, a key on
 * disk, a docker image. `hint` is the longer text behind a short chip, shown
 * in the app tooltip.
 */
export function HintChip({
  children,
  hint,
  onClick,
  dashed = false,
}: {
  children: ReactNode
  hint: string
  onClick: () => void
  /** A suggestion that is not on this machine yet. */
  dashed?: boolean
}): JSX.Element {
  return (
    <Tip label={hint}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 rounded-control border border-glass-border px-2.5 py-0.5 font-mono text-[11.5px] text-muted-foreground outline-none transition-colors',
          'hover:bg-glass-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          dashed ? 'border-dashed' : 'bg-glass',
        )}
      >
        {children}
      </button>
    </Tip>
  )
}
