import type { JSX } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import type { WorkflowIssue } from '../../lib/workflow-validate.js'

/** Pre-run validation errors overlay, shown when Run is pressed on a bad graph. */
export function ValidationPanel({
  errorIssues,
  warningIssues,
  onDismiss,
  onSelectIssue,
}: {
  errorIssues: WorkflowIssue[]
  warningIssues: WorkflowIssue[]
  onDismiss: () => void
  onSelectIssue: (nodeId: string) => void
}): JSX.Element {
  return (
    <div className="absolute left-3 top-3 z-20 w-72 rounded-lg border border-status-error/40 bg-status-error/10 p-3 shadow-floating">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-medium text-status-error">
          Cannot run — {errorIssues.length} {errorIssues.length === 1 ? 'issue' : 'issues'}
        </span>
        <button
          type="button"
          aria-label="Dismiss validation"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {errorIssues.map((issue, i) => (
          <li key={`err-${i}`}>
            <button
              type="button"
              disabled={issue.nodeId === undefined}
              onClick={() => {
                if (issue.nodeId !== undefined) {
                  onSelectIssue(issue.nodeId)
                }
              }}
              className={cn(
                'w-full rounded px-1.5 py-1 text-left text-xs text-status-error',
                issue.nodeId !== undefined && 'hover:bg-status-error/10',
              )}
            >
              {issue.message}
            </button>
          </li>
        ))}
        {warningIssues.map((issue, i) => (
          <li key={`warn-${i}`}>
            <button
              type="button"
              disabled={issue.nodeId === undefined}
              onClick={() => {
                if (issue.nodeId !== undefined) {
                  onSelectIssue(issue.nodeId)
                }
              }}
              className="w-full rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted/40"
            >
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
