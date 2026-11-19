import type { JSX } from 'react'
import { Skeleton } from '../../components/ui/skeleton.js'
import { cn } from '../../lib/utils.js'
import { FINDING_ROWS_CLASS, FINDING_ROW_CLASS } from './FindingList.js'

/** Enough rows to fill the panel without implying a real count. */
const ROWS = 6

/** Staggered widths: a block of identical bars reads as a rendering bug. */
const HOST_WIDTHS = ['w-32', 'w-24', 'w-40'] as const

/**
 * The findings list while it loads. Mirrors FindingList's two-line row (dot,
 * title and status, then the asset and severity line) so the real rows land in
 * place instead of pushing the list around.
 */
export function FindingListSkeleton(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading findings"
      className={cn(FINDING_ROWS_CLASS, 'min-h-0 flex-1 overflow-hidden')}
    >
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className={FINDING_ROW_CLASS}>
          <div className="flex h-[19px] min-w-0 items-center gap-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-[13px] min-w-0 flex-1" />
            <Skeleton className="h-[11px] w-14" />
          </div>
          <div className="flex h-4 items-center justify-between gap-2 pl-4">
            <Skeleton className={cn('h-[10px]', HOST_WIDTHS[i % HOST_WIDTHS.length])} />
            <Skeleton className="h-[10px] w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
