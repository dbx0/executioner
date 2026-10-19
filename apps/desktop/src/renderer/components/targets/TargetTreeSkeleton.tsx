import type { JSX } from 'react'
import { Skeleton } from '../ui/skeleton.js'

/** Indent depth per row, so the placeholder reads as a tree rather than a list. */
const DEPTHS = [0, 1, 1, 0, 1, 2, 1, 0]

/**
 * The target tree while it loads. Mirrors VirtualTargetTree's row — a kind chip
 * and the asset value, indented by depth — so the real tree lands in place.
 */
export function TargetTreeSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading targets" className="min-h-0 flex-1 overflow-hidden py-1">
      {DEPTHS.map((depth, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-[6px]" style={{ paddingLeft: `${String(12 + depth * 16)}px` }}>
          <Skeleton className="size-3.5 shrink-0" />
          <Skeleton className="h-[13px]" style={{ width: `${String(60 - depth * 8 - (i % 3) * 6)}%` }} />
        </div>
      ))}
    </div>
  )
}
