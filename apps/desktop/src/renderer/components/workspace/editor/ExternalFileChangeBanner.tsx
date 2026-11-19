import type { JSX } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { ExternalMutation } from '../../../store/types.js'
import { Button } from '../../ui/button.js'

/**
 * The recovery UI for a file that changed underneath an unsaved buffer.
 *
 * Without this the tab is silently stale until it is closed and reopened, and
 * the next save clobbers the newer disk content unannounced.
 */
export function ExternalFileChangeBanner({
  mutation,
  undoReload,
  onReload,
  onKeepEdits,
  onCompare,
}: {
  mutation: ExternalMutation | null
  /** Present only just after a reload, while the discarded draft can still be restored. */
  undoReload?: () => void
  onReload: () => void
  onKeepEdits: () => void
  onCompare: () => void
}): JSX.Element | null {
  if (mutation === null) {
    if (undoReload === undefined) return null
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-glass-border bg-glass px-3 py-1.5 text-[11px]">
        <span className="text-muted-foreground">Reloaded from disk.</span>
        <Button variant="glass" size="xs" onClick={undoReload}>
          Undo
        </Button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-glass-border bg-status-error/10 px-3 py-1.5 text-[11px]">
      <TriangleAlert className="size-3.5 shrink-0 text-status-error" strokeWidth={1.75} />
      <span className="text-foreground">
        {mutation === 'deleted'
          ? 'This file was deleted on disk. Your unsaved edits are still here.'
          : 'This file changed on disk while you were editing.'}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {mutation === 'changed' && (
          <>
            <Button variant="glass" size="xs" onClick={onCompare}>
          Compare
        </Button>
            <Button variant="glass" size="xs" onClick={onReload}>
          Reload from disk
        </Button>
          </>
        )}
        <Button variant="glass" size="xs" onClick={onKeepEdits}>
          Keep my edits
        </Button>
      </div>
    </div>
  )
}
