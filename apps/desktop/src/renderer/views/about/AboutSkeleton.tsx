import type { JSX } from 'react'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { CARD_ROW_2, CARD_ROW_3, PAGE_STACK } from './layout.js'
import { STAT_GRID } from './StatTiles.js'

const BAR_WIDTHS = ['w-full', 'w-4/5', 'w-3/5', 'w-2/5', 'w-1/4'] as const

/** A card-shaped placeholder: a title bar over a few chart rows. */
function CardSkeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <GlassPanel className="flex flex-col gap-3 p-4">
      <Skeleton className="h-3.5 w-32" />
      {BAR_WIDTHS.slice(0, rows).map((w) => (
        <Skeleton key={w} className={`h-2 rounded-full ${w}`} />
      ))}
    </GlassPanel>
  )
}

/**
 * The page's own layout drawn in placeholder bars, shown while the first
 * overview read is in flight, so the tiles and cards do not jump when it lands.
 * The group is one status region: a screen reader hears one announcement.
 */
export function AboutSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading overview" className={PAGE_STACK}>
      <GlassPanel className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3.5">
          <Skeleton className="size-11 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </GlassPanel>
      <div className={STAT_GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <GlassPanel key={i} data-skeleton-tile className="flex flex-col gap-2 px-3.5 py-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-2.5 w-24" />
          </GlassPanel>
        ))}
      </div>
      <div className={CARD_ROW_2}>
        <CardSkeleton rows={5} />
        <CardSkeleton rows={5} />
      </div>
      <div className={CARD_ROW_3}>
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
      </div>
    </div>
  )
}
