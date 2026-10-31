/** The slice of a CDP Accessibility.AXNode the snapshot reads. */
export interface AXNode {
  nodeId: string
  parentId?: string
  childIds?: string[]
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  backendDOMNodeId?: number
}

export interface Snapshot {
  text: string
  /** ref -> backendDOMNodeId */
  refs: Map<string, number>
  generation: number
  /** Highest ref index issued, so the next snapshot of the same generation can continue after it. */
  last: number
}

const MAX_LINES = 2000

/**
 * Renders the accessibility tree as an indented outline the agent can read and
 * point back at: `- button "Sign in" [ref=g3e12]`. Ignored and `none` nodes
 * add no line and no depth, but their children are still walked.
 */
export function renderSnapshot(nodes: AXNode[], generation: number, startIndex = 0): Snapshot {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const refs = new Map<string, number>()
  const lines: string[] = []
  let n = startIndex
  let truncated = false

  const visit = (node: AXNode, depth: number): void => {
    if (truncated) return
    const role = node.role?.value ?? ''
    const skip = node.ignored === true || role === '' || role === 'none'
    if (!skip) {
      if (lines.length >= MAX_LINES) {
        truncated = true
        return
      }
      const name = node.name?.value
      let line = `${'  '.repeat(depth)}- ${role}`
      if (name) line += ` ${JSON.stringify(name)}`
      if (node.backendDOMNodeId !== undefined) {
        const ref = `g${generation}e${++n}`
        refs.set(ref, node.backendDOMNodeId)
        line += ` [ref=${ref}]`
      }
      lines.push(line)
    }
    for (const id of node.childIds ?? []) {
      const child = byId.get(id)
      if (child) visit(child, skip ? depth : depth + 1)
    }
  }

  for (const node of nodes) if (!node.parentId || !byId.has(node.parentId)) visit(node, 0)
  if (truncated) lines.push('… truncated')
  return { text: lines.join('\n'), refs, generation, last: n }
}
