import type { JSX } from 'react'
import { Skeleton } from '../ui/skeleton.js'

/** Rows inside each placeholder section. */
const SECTIONS = [2, 4, 3]

/**
 * The detail pane while a target's facts load. Mirrors the real pane (name,
 * seen line, edit row, labelled sections) so the content lands where the bars were.
 */
export function TargetDetailSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading target" className="flex h-full flex-col gap-[18px] overflow-hidden px-[22px] py-5">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-6 w-64 rounded-full" />
        <Skeleton className="h-3 w-80 rounded-full" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-64 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
      {SECTIONS.map((rows, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20 rounded-full" />
          <div className="flex flex-col gap-3 rounded-xl border border-glass-border p-3.5">
            {Array.from({ length: rows }, (_, row) => (
              <Skeleton key={row} className="h-3 w-full rounded-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
