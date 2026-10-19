import type { JSX } from 'react'
import { Skeleton } from '../../components/ui/skeleton.js'

/** Enough rows to fill the panel without implying a real count. */
const ROWS = 7

/**
 * The runs list while it loads. Mirrors the row in ExecutionsView — status dot,
 * workflow name, then the target/time line — so the real rows land in place.
 */
export function ExecutionListSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading runs" className="min-h-0 overflow-hidden">
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2">
          <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Skeleton className="size-3.5 shrink-0" />
              {/* Staggered widths: a block of identical bars reads as a rendering bug. */}
              <Skeleton className="h-[12.5px]" style={{ width: `${String(72 - (i % 3) * 14)}%` }} />
            </div>
            <Skeleton className="mt-1.5 h-[11px] w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
