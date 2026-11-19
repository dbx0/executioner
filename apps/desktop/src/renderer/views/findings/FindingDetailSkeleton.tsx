import type { JSX } from 'react'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { Skeleton } from '../../components/ui/skeleton.js'

/**
 * The detail panel while the finding it should show has not arrived, as when a
 * deep link names a finding before the list has loaded. Mirrors FindingDetail:
 * title row, the triage pills, the two prose sections.
 */
export function FindingDetailSkeleton(): JSX.Element {
  return (
    <GlassPanel
      role="status"
      aria-label="Loading finding"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {/* The same centred column as the loaded pane, so nothing shifts when it lands. */}
      <div className="mx-auto flex w-full min-w-0 max-w-[1040px] flex-col gap-[18px] px-[26px] py-[22px]">
      <div className="flex h-10 items-center gap-3">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="ml-auto size-[30px] rounded-full" />
        <Skeleton className="size-[30px] rounded-full" />
        <Skeleton className="h-[30px] w-16 rounded-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-[30px] w-20 rounded-full" />
        <Skeleton className="h-[30px] w-28 rounded-full" />
        <Skeleton className="h-[30px] w-44 rounded-full" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-9/12" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3.5 w-7/12" />
        <Skeleton className="h-40 rounded-[14px]" />
      </div>
      </div>
    </GlassPanel>
  )
}
