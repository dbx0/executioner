import type { TargetNode } from '../api/targets.js'
import type { WorkflowSummary } from '../api/workflows.js'

/** Somewhere a workflow can be run: this machine, or a saved connection. */
export interface RunBackend {
  id: string
  name: string
}

/** Running here needs no saved connection, so it is always an option. */
export const LOCAL_BACKEND: RunBackend = { id: 'local', name: 'this machine' }

export interface RunDestination {
  backendId: string
  label: string
}

export interface WorkflowAction {
  workflowId: string
  name: string
  /**
   * Where this workflow can be sent, or null when there is only one place and
   * picking the workflow is itself the instruction to run it.
   */
  destinations: RunDestination[] | null
}

export interface TargetActionModel {
  /** Pattern an "add to scope" writes. */
  includePattern: string
  /** Pattern a "remove from scope" writes. */
  excludePattern: string
  /** How many assets a delete would take with this one. */
  descendants: number
  /** A subtree delete is irreversible, so it is confirmed rather than obeyed. */
  needsDeleteConfirmation: boolean
  /** The only place a run could go, when there is exactly one. */
  singleDestination: RunBackend | null
  workflows: WorkflowAction[]
}

/** How many assets sit under this one, at any depth. */
export function countDescendants(node: TargetNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0)
}

/**
 * The pattern a scope action writes for a target, for either effect.
 *
 * An apex is written the way a program's scope table states it — as a wildcard
 * covering everything under it — because neither putting `smartfit.com.br` in
 * scope nor ruling it out is meant one subdomain at a time. Anything narrower
 * than an apex is named exactly, reaching no further than the row clicked.
 *
 * Include and exclude deliberately use the same shape. An exclusion that only
 * caught the apex would miss the case it exists for: a parked domain whose
 * wildcard DNS makes every subdomain appear to resolve. Excluding too much is
 * visible — the assets stay in the tree wearing an "out of scope" badge — and
 * is undone by deleting the rule.
 */
export function scopePatternFor(node: TargetNode): string {
  return node.kind === 'domain' ? `*.${node.value}` : node.value
}

/**
 * Everything the right-click menu offers for one target, decided up front.
 *
 * Kept apart from the menu component on purpose: these are the choices worth
 * testing — which pattern a click writes, whether a delete must be confirmed,
 * whether there is a destination worth asking about — and none of them need a
 * menu on screen to be checked.
 */
export function targetActionModel(
  node: TargetNode,
  workflows: WorkflowSummary[],
  backends: RunBackend[],
): TargetActionModel {
  // A choice of one is not a choice: with nowhere to run but this machine, the
  // workflow name is the button and no further panel is worth the hover.
  const singleDestination = backends.length <= 1 ? (backends[0] ?? LOCAL_BACKEND) : null
  const descendants = countDescendants(node)

  return {
    includePattern: scopePatternFor(node),
    excludePattern: scopePatternFor(node),
    descendants,
    needsDeleteConfirmation: descendants > 0,
    singleDestination,
    workflows: workflows.map((workflow) => ({
      workflowId: workflow.id,
      name: workflow.name,
      destinations:
        singleDestination !== null
          ? null
          : backends.map((backend) => ({ backendId: backend.id, label: `Run on ${backend.name}` })),
    })),
  }
}
