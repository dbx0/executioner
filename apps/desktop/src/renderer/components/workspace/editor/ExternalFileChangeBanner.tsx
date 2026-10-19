import type { JSX } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { ExternalMutation } from '../../../store/types.js'

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
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[11px]">
        <span className="text-muted-foreground">Reloaded from disk.</span>
        <button
          type="button"
          onClick={undoReload}
          className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-accent"
        >
          Undo
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-[11px]">
      <TriangleAlert className="size-3.5 shrink-0 text-destructive" strokeWidth={1.75} />
      <span className="text-foreground">
        {mutation === 'deleted'
          ? 'This file was deleted on disk. Your unsaved edits are still here.'
          : 'This file changed on disk while you were editing.'}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {mutation === 'changed' && (
          <>
            <button
              type="button"
              onClick={onCompare}
              className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
            >
              Compare
            </button>
            <button
              type="button"
              onClick={onReload}
              className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
            >
              Reload from disk
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onKeepEdits}
          className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
        >
          Keep my edits
        </button>
      </div>
    </div>
  )
}
