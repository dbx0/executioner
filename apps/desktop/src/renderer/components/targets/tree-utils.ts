import type { TargetNode } from '../../api/targets.js'

/** Every id in the tree, depth first. */
export function collectIds(nodes: TargetNode[], into: string[] = []): string[] {
  for (const n of nodes) {
    into.push(n.id)
    collectIds(n.children, into)
  }
  return into
}

/** How many targets the tree holds, at every depth. */
export function countTree(nodes: TargetNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countTree(n.children), 0)
}

/** Depth-first lookup of a target by id in the (possibly nested) tree. */
export function findInTree(nodes: TargetNode[], id: string): TargetNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findInTree(n.children, id)
    if (hit !== null) return hit
  }
  return null
}

/** Prunes to nodes whose value contains `query`, keeping any ancestor of a match. */
export function filterTreeByText(nodes: TargetNode[], query: string): TargetNode[] {
  if (query.trim() === '') return nodes
  const q = query.toLowerCase()
  const prune = (list: TargetNode[]): TargetNode[] =>
    list
      .map((n) => ({ ...n, children: prune(n.children) }))
      .filter((n) => n.value.toLowerCase().includes(q) || n.children.length > 0)
  return prune(nodes)
}
