import type { JSX } from 'react'
import { cn } from '../../lib/utils.js'
import { listRowClass } from './list-row.js'
import { statusDot } from './run-format.js'

/** One run of the batch on screen, as its tab shows it. */
export interface BatchTab {
  executionId: string
  /** The target it ran against. */
  label: string
  status: string
}

/**
 * A multi-target run at a glance: how many of its runs are done, and a tab per
 * run to switch the pane to it. The batch is one thing you are watching, not
 * the first run plus a list to dig through.
 */
export function BatchStrip({
  batch,
  watchingId,
  onShow,
}: {
  batch: BatchTab[]
  watchingId: string | null
  onShow: (executionId: string) => void
}): JSX.Element {
  const done = batch.filter((b) => b.status !== 'running')
  const failed = done.filter((b) => b.status !== 'succeeded' && b.status !== 'success' && b.status !== 'cancelled')
  const running = done.length < batch.length
  return (
    <div className="shrink-0 border-b border-glass-border">
      <div className="flex items-center gap-2 px-3.5 pt-2 text-[11.5px]">
        <span className={running ? 'font-medium text-status-running' : 'text-muted-foreground'}>
          {running ? 'Running' : 'Finished'}
        </span>
        <span className="ml-auto tabular-nums text-muted-foreground">
          {done.length} of {batch.length} done
          {failed.length > 0 && <span className="text-status-error">{` · ${failed.length} failed`}</span>}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Batch progress"
        aria-valuemin={0}
        aria-valuemax={batch.length}
        aria-valuenow={done.length}
        className="mx-3.5 mt-1.5 h-1 overflow-hidden rounded-full bg-glass-strong"
      >
        <div
          className="h-full rounded-full bg-status-running transition-[width] motion-reduce:transition-none"
          // A computed fraction: there is no utility for an arbitrary runtime width.
          style={{ width: `${(done.length / batch.length) * 100}%` }}
        />
      </div>
      {/* One target per line, scrolling past a handful, so a long batch never
          becomes a strip you scroll sideways through. */}
      <div
        role="tablist"
        aria-label="Runs in this batch"
        aria-orientation="vertical"
        className="scrollbar-sleek flex max-h-32 flex-col gap-0.5 overflow-y-auto px-2 py-1.5"
      >
        {batch.map((b) => (
          <button
            key={b.executionId}
            type="button"
            role="tab"
            aria-selected={b.executionId === watchingId}
            onClick={() => onShow(b.executionId)}
            title={`${b.label}: ${b.status}`}
            className={cn(
              'flex w-full shrink-0 items-center gap-2 px-2 py-1 text-left font-mono text-[11px]',
              listRowClass(b.executionId === watchingId),
            )}
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(b.status))} />
            <span className="min-w-0 flex-1 truncate">{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
