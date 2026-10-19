import type { TargetNode } from '../../api/targets.js'

/** Remember the last-opened workflow per engagement so the canvas reopens it. */
export const LAST_WF_PREFIX = 'exe.lastWorkflow:'

export function saveLastWorkflow(root: string | null, id: string | null): void {
  if (root === null) return
  try {
    if (id === null) localStorage.removeItem(LAST_WF_PREFIX + root)
    else localStorage.setItem(LAST_WF_PREFIX + root, id)
  } catch {
    /* storage unavailable */
  }
}

export function flatten(nodes: TargetNode[]): TargetNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}
