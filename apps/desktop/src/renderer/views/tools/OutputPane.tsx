import type { JSX } from 'react'
import { Maximize2, Square } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { LoadingState, Spinner } from '../../components/ui/spinner.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'
import type { StandaloneRun } from '../../api/executions.js'
import type { SafeRow } from '../executions/row.js'
import { NodeOutputBody } from '../executions/NodeOutputBody.js'
import { BatchStrip, type BatchTab } from './BatchStrip.js'
import { LiveStream } from './LiveStream.js'
import { RecentRuns } from './RecentRuns.js'
import { elapsed, statusDot } from './run-format.js'

export { statusDot } from './run-format.js'
export { splitMatches } from './LiveStream.js'
export type { BatchTab } from './BatchStrip.js'

/** The run the page is currently watching. */
export interface LiveRun {
  executionId: string
  nodeId: string
  /** 'running' until a done event arrives, then the engine's final status. */
  status: string
  startedAt: number
}

/** A quiet line filling the output area when there is nothing to stream or show. */
function OutputNote({ children }: { children: string }): JSX.Element {
  return <p className="min-h-0 flex-1 p-3.5 text-[12.5px] text-muted-foreground">{children}</p>
}

/**
 * The output pane: the watched run on top, the recent standalone runs below it.
 * While a run is live its stream scrolls by raw; once it settles the pane shows
 * what the engine saved, as the same stdout / stderr / parsed tabs a workflow
 * node's output gets. Selecting a recent run reloads the form that produced it
 * and shows that run's output, so a run is repeatable without retyping params.
 */
export function OutputPane({
  live,
  lines,
  result,
  onExpand,
  now,
  stopping,
  onStop,
  recent,
  selectedNodeId,
  watchingId,
  connectionLabel,
  nodeName,
  onReplay,
  batch = [],
  onShowRun,
}: {
  live: LiveRun | null
  lines: string[]
  /** The settled run's saved output: undefined while it loads, null when the
   *  engine has none for it. Ignored while the run is live. */
  result: SafeRow | null | undefined
  /** Open the saved output in the full-size dialog. */
  onExpand: () => void
  /** A ticking clock, so the elapsed time advances while a run is live. */
  now: number
  stopping: boolean
  onStop: () => void
  recent: StandaloneRun[]
  /** The tool picked in the form; the history can narrow to its runs. */
  selectedNodeId: string | null
  /** The run shown above, marked in the history so it is clear which one it is. */
  watchingId: string | null
  /** Where a run executed, in words: its connection's name when known. */
  connectionLabel: (run: StandaloneRun) => string
  /** Resolve a node id to its display name; falls back to the id. */
  nodeName: (id: string) => string
  onReplay: (run: StandaloneRun) => void
  /** The runs of the last multi-target Run, shown as tabs; fewer than two shows none. */
  batch?: BatchTab[]
  /** Switch the pane to one run of the batch. */
  onShowRun?: (executionId: string) => void
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {live !== null && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-glass-border px-3.5">
          <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">{nodeName(live.nodeId)}</span>
          <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(live.status))} />
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
            {live.status === 'running' ? elapsed(live.startedAt, now) : live.status}
          </span>
          {live.status === 'running' && (
            <Tip label="Stop run">
              <Button
                variant="glass"
                size="icon-xs"
                aria-label="Stop run"
                className="ml-auto"
                disabled={stopping}
                onClick={onStop}
              >
                {stopping ? <Spinner size="sm" /> : <Square className="size-3" />}
              </Button>
            </Tip>
          )}
          {live.status !== 'running' && result != null && (
            <Tip label="Expand output">
              <Button variant="glass" size="icon-xs" aria-label="Expand output" className="ml-auto" onClick={onExpand}>
                <Maximize2 className="size-3" />
              </Button>
            </Tip>
          )}
        </div>
      )}

      {batch.length > 1 && onShowRun !== undefined && (
        <BatchStrip batch={batch} watchingId={watchingId} onShow={onShowRun} />
      )}

      {live !== null && live.status !== 'running' ? (
        result === undefined ? (
          <LoadingState label="Loading output" className="h-auto min-h-0 flex-1" />
        ) : result === null ? (
          <OutputNote>No output was saved for this run.</OutputNote>
        ) : (
          // Keyed by run so switching runs resets the tab to that run's own default.
          <NodeOutputBody
            key={live.executionId}
            row={result}
            preferParsed
            subject="run"
            className="[--output-gutter:0.875rem]"
          />
        )
      ) : live === null ? (
        <OutputNote>Pick a recent run to see its output.</OutputNote>
      ) : (
        <LiveStream key={live.executionId} lines={lines} />
      )}

      <RecentRuns
        recent={recent}
        selectedNodeId={selectedNodeId}
        watchingId={watchingId}
        now={now}
        connectionLabel={connectionLabel}
        nodeName={nodeName}
        onReplay={onReplay}
      />
    </div>
  )
}
