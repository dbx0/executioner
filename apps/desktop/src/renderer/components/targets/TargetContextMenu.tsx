import type { JSX } from 'react'
import { useState } from 'react'
import { Play, ShieldCheck, ShieldX, Trash2, TriangleAlert, Wrench } from 'lucide-react'
import type { TargetNode } from '../../api/targets.js'
import type { WorkflowSummary } from '../../api/workflows.js'
import { Button } from '../ui/button.js'
import { targetActionModel, type RunBackend } from '../../lib/target-actions.js'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../ui/context-menu.js'

export interface TargetContextMenuProps {
  node: TargetNode
  workflows: WorkflowSummary[]
  /** Everywhere a run could happen, `local` first. */
  backends: RunBackend[]
  onAddToScope: (pattern: string) => void
  onRemoveFromScope: (pattern: string) => void
  onRunWorkflow: (workflowId: string, backendId: string) => void
  /** Open the Tools page with this target picked, to run a single tool on it. */
  onRunTool: () => void
  onDelete: () => void
  /** The row this menu belongs to. */
  children: React.ReactNode
}

/**
 * Right-click actions for one target, wrapped around the row they act on.
 *
 * Built on Radix's context-menu rather than hand-positioned divs: every panel is
 * portalled, so a submenu is never clipped by — nor adds scrollbars to — an
 * ancestor that scrolls, and collision flipping, keyboard navigation and focus
 * return come with it.
 */
export function TargetContextMenu({
  node,
  workflows,
  backends,
  onAddToScope,
  onRemoveFromScope,
  onRunWorkflow,
  onRunTool,
  onDelete,
  children,
}: TargetContextMenuProps): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const actions = targetActionModel(node, workflows, backends)
  const { descendants, singleDestination } = actions

  return (
    <ContextMenu onOpenChange={(open) => !open && setConfirmingDelete(false)}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

      <ContextMenuContent aria-label={`Actions for ${node.value}`}>
        <div className="truncate px-2 py-1.5 font-mono text-[11.5px] text-muted-foreground">{node.value}</div>
        <ContextMenuSeparator />

        {confirmingDelete ? (
          <div className="max-w-[17rem] px-2 py-1.5">
            <p className="flex items-start gap-1.5 text-[12px] text-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" strokeWidth={2} />
              <span>
                Delete <span className="font-mono">{node.value}</span> and the {descendants}{' '}
                {descendants === 1 ? 'asset' : 'assets'} under it? Their facts and history go too.
              </span>
            </p>
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={onDelete}>
                Delete anyway
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ContextMenuItem onSelect={() => onAddToScope(actions.includePattern)}>
              <ShieldCheck />
              Add to scope
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onRemoveFromScope(actions.excludePattern)}>
              <ShieldX />
              Remove from scope
            </ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Play />
                Run workflow
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {/* With one destination the header is the whole story; with
                    several there is no single answer, and each workflow opens a
                    panel naming them instead. */}
                {singleDestination !== null && (
                  <ContextMenuLabel>Runs on {singleDestination.name}</ContextMenuLabel>
                )}

                {actions.workflows.length === 0 ? (
                  <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No workflows yet</div>
                ) : (
                  actions.workflows.map((workflow) =>
                    workflow.destinations === null ? (
                      <ContextMenuItem
                        key={workflow.workflowId}
                        onSelect={() =>
                          onRunWorkflow(workflow.workflowId, (singleDestination as RunBackend).id)
                        }
                      >
                        <span className="truncate">{workflow.name}</span>
                      </ContextMenuItem>
                    ) : (
                      <ContextMenuSub key={workflow.workflowId}>
                        <ContextMenuSubTrigger>
                          <span className="truncate">{workflow.name}</span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent aria-label="Where to run">
                          {workflow.destinations.map((destination) => (
                            <ContextMenuItem
                              key={destination.backendId}
                              onSelect={() => onRunWorkflow(workflow.workflowId, destination.backendId)}
                            >
                              <span className="truncate">{destination.label}</span>
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    ),
                  )
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onSelect={onRunTool}>
              <Wrench />
              Run tool…
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
              destructive
              onSelect={(e) => {
                if (!actions.needsDeleteConfirmation) {
                  onDelete()
                  return
                }
                // Deleting a subtree is the one irreversible click here, so the
                // menu stays open and asks instead of closing on the selection.
                e.preventDefault()
                setConfirmingDelete(true)
              }}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
