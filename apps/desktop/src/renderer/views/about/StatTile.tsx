import type { JSX } from 'react'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { cn } from '../../lib/utils.js'
import { useCountUp } from '../../lib/motion.js'

export interface StatTileProps {
  /** Position in the row, which staggers the count-up. */
  index?: number
  label: string
  value: number | string
  sub?: string
  /** A text color class for the number, when the value itself is a signal. */
  tone?: string | undefined
  /** Makes the tile a button that opens the page the number comes from. */
  onClick?: (() => void) | undefined
}

const TILE = 'flex min-w-0 flex-col gap-1 px-4 py-3 text-left'

/** One headline number with a label above and a quiet sub-line under it. The
 *  number counts up from zero once, on the first load that has something to show. */
export function StatTile({ index = 0, label, value, sub, tone, onClick }: StatTileProps): JSX.Element {
  const counted = useCountUp(typeof value === 'number' ? value : 0, 1400, 350 + index * 50)
  const shown = typeof value === 'number' ? counted.toLocaleString('en-US') : value
  const body = (
    <>
      <div className="truncate text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn('text-[26px] font-semibold leading-[1.1] tabular-nums tracking-[-0.02em]', tone)}>{shown}</div>
      <div className="truncate text-[11.5px] text-muted-foreground">{sub ?? ''}</div>
    </>
  )
  if (onClick === undefined) {
    return (
      <GlassPanel data-stat={label} className={TILE}>
        {body}
      </GlassPanel>
    )
  }
  return (
    <GlassPanel asChild data-stat={label} className={cn(TILE, 'outline-none transition-colors hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/50')}>
      <button type="button" onClick={onClick}>
        {body}
      </button>
    </GlassPanel>
  )
}
