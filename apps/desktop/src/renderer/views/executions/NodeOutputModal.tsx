import type { JSX } from 'react'
import type { NodeOutputRow } from '../../api/executions.js'
import { Dialog, DialogHeader } from '../../components/ui/dialog.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'
import { safeRow } from './row.js'
import { NodeOutputBody, isFailed } from './NodeOutputBody.js'

const EXIT_CLASS = 'shrink-0 font-mono text-[11px] text-muted-foreground'

/**
 * One node's full output. stderr gets its own tab and is selected first when a
 * node failed, since that is where the reason is, including the engine's own
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
    <Dialog onClose={onClose} label={`${row.nodeId} output`} size="xl" className="h-[80vh]">
      <DialogHeader
        title={<span className="font-mono font-medium">{row.nodeId}</span>}
        closeButton
        actions={
          <>
            <span
              className={cn(
                'shrink-0 rounded-control px-2 py-0.5 text-[11px] capitalize',
                failed ? 'bg-status-error/15 text-status-error' : 'bg-glass-strong text-muted-foreground',
              )}
            >
              {row.status}
            </span>
            {typeof row.exitCode === 'number' ? (
              <span className={EXIT_CLASS}>exit {row.exitCode}</span>
            ) : row.exitCode === null ? (
              <Tip label="The process never started">
                <span className={EXIT_CLASS}>no exit code</span>
              </Tip>
            ) : null}
          </>
        }
      />
      <NodeOutputBody row={row} preferParsed={preferParsed} subject={subject} />
    </Dialog>
  )
}
