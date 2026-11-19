import type { JSX } from 'react'
import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { segmentClass } from '../../components/ui/segmented.js'
import { cn } from '../../lib/utils.js'
import type { StandaloneRun } from '../../api/executions.js'
import { listRowClass, SECTION_LABEL } from './list-row.js'
import { runTiming, statusDot } from './run-format.js'

/**
 * The standalone run history under the output. It narrows to the picked tool
 * by default: its earlier runs are what you compare against. "All" is one
 * click away. Picking a run loads the form that produced it.
 */
export function RecentRuns({
  recent,
  selectedNodeId,
  watchingId,
  now,
  connectionLabel,
  nodeName,
  onReplay,
}: {
  recent: StandaloneRun[]
  /** The tool picked in the form; the history can narrow to its runs. */
  selectedNodeId: string | null
  /** The run shown above, marked so it is clear which one it is. */
  watchingId: string | null
  now: number
  connectionLabel: (run: StandaloneRun) => string
  nodeName: (id: string) => string
  onReplay: (run: StandaloneRun) => void
}): JSX.Element {
  const [onlyTool, setOnlyTool] = useState(true)
  const narrowed = onlyTool && selectedNodeId !== null
  const history = narrowed ? recent.filter((r) => r.nodeId === selectedNodeId) : recent

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col border-t border-glass-border">
      <div className="flex min-h-9 shrink-0 items-center gap-2 px-3.5 py-1.5">
        <span className={SECTION_LABEL}>Recent runs</span>
        {selectedNodeId !== null && (
          <div
            role="group"
            aria-label="Show runs of"
            className="glass-capsule ml-auto inline-flex h-6 items-center gap-0.5 p-[2px]"
          >
            {([
              [true, nodeName(selectedNodeId)],
              [false, 'All'],
            ] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={onlyTool === value}
                aria-label={value ? `Runs of ${label}` : 'All runs'}
                onClick={() => setOnlyTool(value)}
                className={cn(segmentClass(onlyTool === value), 'block h-5 max-w-32 truncate px-2 text-[11px] leading-5')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {history.length === 0 ? (
          <p className="px-1.5 pb-2 text-[12px] text-muted-foreground">
            {narrowed ? `No runs of ${nodeName(selectedNodeId)} yet.` : 'Nothing yet.'}
          </p>
        ) : (
          history.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onReplay(run)}
              aria-label={`Load ${nodeName(run.nodeId)} run against ${run.targetValue ?? 'a removed target'}`}
              aria-current={run.id === watchingId ? 'true' : undefined}
              className={cn('group flex w-full items-center gap-2 px-2 py-1.5 text-left', listRowClass(run.id === watchingId))}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(run.status))} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{nodeName(run.nodeId)}</span>
                  {runTiming(run, now) !== null && (
                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                      {runTiming(run, now)}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {run.targetValue ?? 'target removed'} · {connectionLabel(run)}
                </span>
              </span>
              <RotateCcw aria-hidden className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
