import type { JSX } from 'react'
import { X } from 'lucide-react'
import type { NodeOutputRow } from '../../api/executions.js'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import { safeRow } from './row.js'
import { NodeOutputBody, isFailed } from './NodeOutputBody.js'

/**
 * One node's full output. stderr gets its own tab and is selected first when a
 * node failed, since that is where the reason is — including the engine's own
 * "could not run X" line when a tool isn't installed on the chosen backend.
 */
export function NodeOutputModal({
  row: raw,
  onClose,
  preferParsed = false,
  subject = 'node',
}: {
  row: NodeOutputRow
  onClose: () => void
  /** Open on the parsed rows whenever there are any. */
  preferParsed?: boolean
  /** What the empty-state copy calls the thing that ran. */
  subject?: 'node' | 'run'
}): JSX.Element {
  const row = safeRow(raw)
  const failed = isFailed(row)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${row.nodeId} output`}
        className="flex max-h-[80vh] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <span className="truncate font-mono text-[14px] font-medium">{row.nodeId}</span>
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[11px] capitalize',
              failed ? 'bg-status-error/15 text-status-error' : 'bg-surface-3 text-muted-foreground',
            )}
          >
            {row.status}
          </span>
          {typeof row.exitCode === 'number' ? (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">exit {row.exitCode}</span>
          ) : row.exitCode === null ? (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title="The process never started">
              no exit code
            </span>
          ) : null}
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>

        <NodeOutputBody row={row} preferParsed={preferParsed} subject={subject} />
      </div>
    </div>
  )
}
