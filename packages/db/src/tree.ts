import type { Target } from '@exe/protocol'

export interface TargetNode extends Target {
  children: TargetNode[]
}

/**
 * Assembles flat target rows into a forest. A target whose parent_id points at
 * a row that is not present is treated as a root, so a filtered query never
 * silently loses data. Nodes that participate in a cycle are unreachable from
 * any root and are omitted rather than causing infinite recursion.
 */
export function buildTargetTree(targets: Target[]): TargetNode[] {
  const nodes = new Map<string, TargetNode>()
  for (const target of targets) {
    nodes.set(target.id, { ...target, children: [] })
  }

  const roots: TargetNode[] = []
  for (const node of nodes.values()) {
    // A self-parent (parent_id === id) would nest a node under itself; treat it
    // as a root instead of pushing it into its own children.
    const parent = node.parentId === null || node.parentId === node.id ? undefined : nodes.get(node.parentId)
    if (parent === undefined) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }
  }

  // A cycle produces nodes that are each other's children with no root, so they
  // simply never appear in `roots`. Nothing further is needed to terminate.
  const byValue = (a: TargetNode, b: TargetNode) => a.value.localeCompare(b.value)
  const sortDeep = (list: TargetNode[]) => {
    list.sort(byValue)
    for (const item of list) sortDeep(item.children)
  }
  sortDeep(roots)

  return roots
}
