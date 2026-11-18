import type { JSX } from 'react'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import type { WorkflowSummary } from '../../api/workflows.js'
import { ExecutionsView } from '../ExecutionsView.js'
import { AddTile, WorkflowCard, WorkflowCardsSkeleton } from './cards.js'
import { ResizableRows, SectionLabel } from './layout.js'

/**
 * The Workflows tab: a resizable vertical split with the workflow grid on top
 * and recent runs below. Drag the divider to expand either pane.
 */
export function WorkflowsPanel({
  workflows,
  onCreate,
  onPreview,
  onDuplicate,
  onDelete,
  loading,
  duplicatingId,
  deletingId,
}: {
  workflows: WorkflowSummary[]
  onCreate: () => void
  onPreview: (w: WorkflowSummary) => void
  onDuplicate: (id: string) => void
  onDelete: (w: WorkflowSummary) => void
  /** First load still in flight: show placeholder tiles instead of an empty grid. */
  loading: boolean
  /** The workflow being duplicated or deleted right now, if any. */
  duplicatingId: string | null
  deletingId: string | null
}): JSX.Element {
  return (
    <ResizableRows
      storageKey="exe.workflowsSplit"
      top={
        <section data-tour="workflows-list" className="flex min-h-0 flex-1 flex-col gap-2 px-1 pt-1">
          <SectionLabel>Workflows</SectionLabel>
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-panel pb-1">
              <AddTile label="Create workflow" onClick={onCreate} />
              {loading && <WorkflowCardsSkeleton />}
              {workflows.map((w) => (
                <WorkflowCard
                  key={w.id}
                  workflow={w}
                  duplicating={duplicatingId === w.id}
                  deleting={deletingId === w.id}
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
        <section data-tour="workflows-runs" className="flex min-h-0 flex-1 flex-col gap-2">
          <SectionLabel className="px-1">Recent runs</SectionLabel>
          {/* The embedded runs view lays out its own glass panels. */}
          <div className="min-h-0 flex-1">
            <ExecutionsView embedded />
          </div>
        </section>
      }
    />
  )
}
