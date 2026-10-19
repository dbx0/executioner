import type { Adjacency } from './adjacency.js'
import { ConditionError, evaluateCondition } from './condition.js'

/** The branch an IF node takes, plus why, when the expression didn't evaluate. */
export interface IfOutcome {
  branch: 'true' | 'false'
  /** Set when the expression could not be evaluated at all. */
  error?: string
}

/**
 * Evaluates an IF node expression against a `data` object and returns which
 * branch handle to take. The expression is read by the restricted condition
 * language in condition.ts, never compiled as JavaScript: workflows can be
 * imported, and a condition can be templated from tool output.
 *
 * An expression that fails still takes the false branch — halting a whole run
 * over one bad condition would be worse — but the reason comes back with it, so
 * the caller can record a broken condition instead of silently branching false.
 */
export function evaluateIfOutcome(expression: string, data: unknown): IfOutcome {
  if (expression.trim() === '') return { branch: 'false', error: 'the condition is empty' }
  try {
    return { branch: evaluateCondition(expression, data) ? 'true' : 'false' }
  } catch (e) {
    return { branch: 'false', error: e instanceof ConditionError ? e.message : String(e) }
  }
}

/** Branch only, for callers that don't care why. */
export function evaluateIf(expression: string, data: unknown): 'true' | 'false' {
  return evaluateIfOutcome(expression, data).branch
}

/**
 * When an IF node takes `takenBranch`, mark every node that is reachable ONLY
 * through the non-taken, explicitly-handled branch as skipped. A node also
 * reachable by an unlabelled edge (sourceHandle null) or by the taken branch is
 * never skipped. Mirrors _propagate_skip in the previous worker.
 */
export function propagateSkip(
  ifNodeId: string,
  takenBranch: string,
  adj: Adjacency,
  skipped: Set<string>,
): void {
  // Seed with the direct targets of the non-taken, explicitly-labelled edges.
  const queue: string[] = []
  for (const edge of adj.forward.get(ifNodeId) ?? []) {
    if (edge.sourceHandle !== null && edge.sourceHandle !== takenBranch) {
      queue.push(edge.target)
    }
  }

  while (queue.length > 0) {
    const node = queue.shift()!
    if (skipped.has(node)) continue

    // A node survives if any incoming edge does not originate in the skip set
    // via a branch edge, i.e. it has another live path in.
    const stillReachable = (adj.reverse.get(node) ?? []).some((rev) => {
      if (skipped.has(rev.source)) return false
      // The IF's non-taken branch edge itself is not a live path.
      if (rev.source === ifNodeId && rev.sourceHandle !== null && rev.sourceHandle !== takenBranch) {
        return false
      }
      return true
    })
    if (stillReachable) continue

    skipped.add(node)
    for (const edge of adj.forward.get(node) ?? []) {
      queue.push(edge.target)
    }
  }
}

/**
 * The loop body is every node reachable from the loop node through edges whose
 * handle is not `done`. A `done` edge is the exit path, run once after the loop.
 * Mirrors _bfs_loop_body in the previous worker.
 */
export function loopBody(loopNodeId: string, adj: Adjacency): Set<string> {
  const body = new Set<string>()
  const queue: string[] = []
  for (const edge of adj.forward.get(loopNodeId) ?? []) {
    if (edge.sourceHandle !== 'done') queue.push(edge.target)
  }

  while (queue.length > 0) {
    const node = queue.shift()!
    if (body.has(node)) continue
    body.add(node)
    for (const edge of adj.forward.get(node) ?? []) {
      if (edge.sourceHandle !== 'done') queue.push(edge.target)
    }
  }
  return body
}
