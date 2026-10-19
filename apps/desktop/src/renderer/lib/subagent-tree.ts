import type { Subagent } from '../store.js'

/** A sub-agent plus its own recursively-nested sub-agents. */
export interface SubagentNode extends Subagent {
  children: SubagentNode[]
}

/**
 * Build the recursive sub-agent lineage tree from the flat, parentId-linked
 * list the store holds. Rows whose `parentId` is absent (or points at a row not
 * in the list — e.g. a parent already reaped) surface as roots, so nothing is
 * ever dropped. Insertion order is preserved at every level. A row that names
 * itself as parent is treated as a root (self-cycle guard).
 */
export function buildSubagentTree(list: readonly Subagent[]): SubagentNode[] {
  const nodes = new Map<string, SubagentNode>()
  for (const sub of list) nodes.set(sub.id, { ...sub, children: [] })
  const roots: SubagentNode[] = []
  for (const sub of list) {
    const node = nodes.get(sub.id)
    if (node === undefined) continue
    const parent = sub.parentId !== undefined ? nodes.get(sub.parentId) : undefined
    if (parent !== undefined && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** True when this node or any descendant is still working — freshness
 *  propagates UP so an ancestor keeps its spinner while any child runs. */
export function subtreeHasWorking(node: SubagentNode): boolean {
  return node.state === 'working' || node.children.some(subtreeHasWorking)
}

/** True when any node in the forest (or a descendant) is still working. */
export function anySubtreeWorking(nodes: readonly SubagentNode[]): boolean {
  return nodes.some(subtreeHasWorking)
}
