import type { JSX } from 'react'
import { Crosshair, Square, Workflow } from 'lucide-react'
import type { ExecutionSummary } from '../../api/executions.js'
import { Spinner } from '../../components/ui/spinner.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'
import { shortId, statusColor, statusDot } from './status.js'

/**
 * The runs of this engagement, newest first. Each row is a pill-cornered card:
 * the selected one takes the brighter glass fill, and a running one carries its
 * own stop control.
 */
export function ExecutionList({
  rows,
  selected,
  stopping,
  workflowNames,
  targetValues,
  onSelect,
  onStop,
}: {
  rows: ExecutionSummary[]
  selected: string | undefined
  /** The run whose stop is in flight, so its button cannot be pressed twice. */
  stopping: string | null
  workflowNames: Record<string, string>
  targetValues: Record<string, string>
  onSelect: (id: string) => void
  onStop: (id: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 p-2">
      {rows.map((r) => (
        <div
          key={r.id}
          className={cn(
            'flex w-full items-start gap-1.5 rounded-[12px] pr-2.5 transition-colors',
            r.id === selected ? 'bg-glass-active' : 'hover:bg-glass-strong',
          )}
        >
          <button
            type="button"
            aria-current={r.id === selected ? 'true' : undefined}
            onClick={() => onSelect(r.id)}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className={cn('mt-1.5 size-2 shrink-0 self-start rounded-full', statusDot(r.status))} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Workflow className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="truncate text-[12.5px] font-medium">
                  {r.workflowId === null ? 'Single node' : (workflowNames[r.workflowId] ?? 'Workflow')}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Crosshair className="size-3 shrink-0" strokeWidth={1.75} />
                <span className="truncate font-mono">
                  {r.targetId !== null ? (targetValues[r.targetId] ?? shortId(r.targetId)) : 'no target'}
                </span>
              </div>
              {r.startedAt !== null && (
                <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                  {new Date(r.startedAt).toLocaleString()}
                </div>
              )}
            </div>
          </button>
          <span className={cn('shrink-0 self-start pt-2 text-[11px] font-medium capitalize', statusColor(r.status))}>
            {r.status}
          </span>
          {r.status === 'running' && (
            // Deliberately not a Button: its icon size is a 32px box, and a
            // padded target that large next to the row's own click area is easy
            // to hit by accident. The glyph itself is the target.
            <Tip label="Stop run">
              <button
                type="button"
                className="shrink-0 self-start rounded-full pt-[9px] leading-none text-muted-foreground outline-none transition-colors hover:text-status-error focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                aria-label={`Stop run ${shortId(r.id)}`}
                disabled={stopping === r.id}
                onClick={() => onStop(r.id)}
              >
                {stopping === r.id ? <Spinner size="xs" /> : <Square className="size-3 fill-current" strokeWidth={0} />}
              </button>
            </Tip>
          )}
        </div>
      ))}
    </div>
  )
}
