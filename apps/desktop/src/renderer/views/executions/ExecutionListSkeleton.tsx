import type { JSX } from 'react'
import { Skeleton } from '../../components/ui/skeleton.js'
import { cn } from '../../lib/utils.js'

/** Enough rows to fill the panel without implying a real count. */
const ROWS = 7
/** Staggered widths: a block of identical bars reads as a rendering bug. */
const WIDTHS = ['w-[72%]', 'w-[58%]', 'w-[44%]'] as const

/**
 * The runs list while it loads. Mirrors the row in ExecutionList (status dot,
 * workflow name, then the target/time line) so the real rows land in place.
 */
export function ExecutionListSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading runs" className="flex min-h-0 flex-col gap-0.5 overflow-hidden p-2">
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="flex w-full items-start gap-2.5 px-3 py-2">
          <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Skeleton className="size-3.5 shrink-0" />
              <Skeleton className={cn('h-[12.5px]', WIDTHS[i % WIDTHS.length])} />
            </div>
            <Skeleton className="mt-1.5 h-[11px] w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
