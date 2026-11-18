import type { JSX } from 'react'
import { Skeleton } from '../ui/skeleton.js'

/** Indent depth per row, so the placeholder reads as a tree rather than a list. */
const DEPTHS = [0, 1, 1, 0, 1, 2, 1, 0]

/**
 * The target tree while it loads. Mirrors VirtualTargetTree's row (a kind icon
 * and the asset value, indented by depth, on the same row pitch) so the real
 * tree lands in place.
 */
export function TargetTreeSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading targets" className="min-h-0 flex-1 overflow-hidden p-2">
      {DEPTHS.map((depth, i) => (
        // Indent and bar width vary per row, which only inline styles can express.
        <div key={i} className="flex h-[33px] items-center gap-2" style={{ paddingLeft: `${String(10 + depth * 18)}px` }}>
          <Skeleton className="size-3.5 shrink-0 rounded-full" />
          <Skeleton className="h-3 rounded-full" style={{ width: `${String(60 - depth * 8 - (i % 3) * 6)}%` }} />
        </div>
      ))}
    </div>
  )
}
