import type { JSX } from 'react'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import type { WorkflowSummary } from '../../api/workflows.js'
import { ExecutionsView } from '../ExecutionsView.js'
import { AddTile, WorkflowCard, WorkflowCardsSkeleton } from './cards.js'
import { ResizableRows, SectionLabel } from './layout.js'

/**
 * The Workflows tab: a resizable vertical split — the workflow grid on top,
 * recent runs below. Drag the divider to expand either pane.
 */
export function WorkflowsPanel({
  workflows,
  onCreate,
  onPreview,
  onDuplicate,
  onDelete,
  loading,
}: {
  workflows: WorkflowSummary[]
  onCreate: () => void
  onPreview: (w: WorkflowSummary) => void
  onDuplicate: (id: string) => void
  onDelete: (w: WorkflowSummary) => void
  /** First load still in flight: show placeholder tiles instead of an empty grid. */
  loading: boolean
}): JSX.Element {
  return (
    <ResizableRows
      storageKey="exe.workflowsSplit"
      top={
        <section className="flex min-h-0 flex-1 flex-col gap-2 p-4 pb-2">
          <SectionLabel>Workflows</SectionLabel>
          <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3 pb-1">
              <AddTile label="Create workflow" onClick={onCreate} />
              {loading && <WorkflowCardsSkeleton />}
              {workflows.map((w) => (
                <WorkflowCard
                  key={w.id}
                  workflow={w}
                  onPreview={() => onPreview(w)}
                  onDuplicate={() => onDuplicate(w.id)}
                  onDelete={() => onDelete(w)}
                />
              ))}
            </div>
          </ScrollArea>
        </section>
      }
      bottom={
        <section className="flex min-h-0 flex-1 flex-col gap-2 p-4 pt-2">
          <SectionLabel>Recent runs</SectionLabel>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card/30">
            <ExecutionsView embedded />
          </div>
        </section>
      }
    />
  )
}
