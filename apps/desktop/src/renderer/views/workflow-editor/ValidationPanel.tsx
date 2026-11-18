import type { JSX } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import type { WorkflowIssue } from '../../lib/workflow-validate.js'
import { FloatingPanel } from '../../components/canvas/surface.js'

/** One issue row. It selects the node it names, or is inert for a graph-wide issue. */
function IssueRow({
  issue,
  tone,
  onSelectIssue,
}: {
  issue: WorkflowIssue
  tone: 'error' | 'warning'
  onSelectIssue: (nodeId: string) => void
}): JSX.Element {
  const nodeId = issue.nodeId
  return (
    <li>
      <button
        type="button"
        disabled={nodeId === undefined}
        onClick={() => {
          if (nodeId !== undefined) onSelectIssue(nodeId)
        }}
        className={cn(
          'w-full rounded-[9px] px-2 py-1 text-left text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
          tone === 'error' ? 'text-status-error' : 'text-muted-foreground',
          nodeId !== undefined && 'hover:bg-glass-strong',
        )}
      >
        {issue.message}
      </button>
    </li>
  )
}

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
    <FloatingPanel role="alert" className="absolute left-0 top-0 z-20 w-72 border-status-error/40 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2 pl-2">
        <span className="text-[13px] font-semibold text-status-error">
          Cannot run: {errorIssues.length} {errorIssues.length === 1 ? 'issue' : 'issues'}
        </span>
        <button
          type="button"
          aria-label="Dismiss validation"
          onClick={onDismiss}
          className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-glass-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      <ul className="flex flex-col gap-px">
        {errorIssues.map((issue, i) => (
          <IssueRow key={`err-${i}`} issue={issue} tone="error" onSelectIssue={onSelectIssue} />
        ))}
        {warningIssues.map((issue, i) => (
          <IssueRow key={`warn-${i}`} issue={issue} tone="warning" onSelectIssue={onSelectIssue} />
        ))}
      </ul>
    </FloatingPanel>
  )
}
