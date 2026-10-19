import type { JSX } from 'react'
import { Skeleton } from '../../components/ui/skeleton.js'

/** Enough rows to fill the panel without implying a real count. */
const ROWS = 6

/**
 * The findings list while it loads. Mirrors FindingList's row — severity chip,
 * title, status chip, then the two-line description — so the real rows land in
 * place instead of pushing the list around.
 */
export function FindingListSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading findings" className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="flex w-full min-w-0 flex-col gap-1 border-b border-border/60 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Skeleton className="h-[14px] w-12 rounded-full" />
            <Skeleton className="h-[13px] min-w-0 flex-1" />
            <Skeleton className="h-[14px] w-14 rounded-full" />
          </div>
          {/* Staggered widths: a block of identical bars reads as a rendering bug. */}
          <Skeleton className="h-[11.5px]" style={{ width: `${String(84 - (i % 3) * 17)}%` }} />
        </div>
      ))}
    </div>
  )
}
