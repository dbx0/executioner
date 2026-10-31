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

/** Where a ref's node lives: its backend id, plus the iframe session or same-process frame holding it. */
export interface RefTarget {
  backendNodeId: number
  sessionId?: string
  frameId?: string
}

/** One frame's AX nodes. A `header` makes it render as a `- frame "<url>" [frame=f<n>]` section. */
export interface FrameSection {
  nodes: AXNode[]
  header?: { url: string; label: string }
  sessionId?: string
  frameId?: string
}

export interface FramesSnapshot {
  text: string
  refs: Map<string, RefTarget>
  generation: number
  last: number
}

const MAX_LINES = 2000

/**
 * Renders the accessibility tree as an indented outline the agent can read and
 * point back at: `- button "Sign in" [ref=g3e12]`. Ignored and `none` nodes
 * add no line and no depth, but their children are still walked.
 */
export function renderSnapshot(nodes: AXNode[], generation: number, startIndex = 0): Snapshot {
  const snap = renderFrames([{ nodes }], generation, startIndex)
  const refs = new Map<string, number>()
  for (const [ref, target] of snap.refs) refs.set(ref, target.backendNodeId)
  return { text: snap.text, refs, generation, last: snap.last }
}

/** Renders several frames one after another; refs and the 2000-line cap are shared across them. */
export function renderFrames(sections: FrameSection[], generation: number, startIndex = 0): FramesSnapshot {
  const refs = new Map<string, RefTarget>()
  const lines: string[] = []
  let n = startIndex
  let truncated = false

  for (const section of sections) {
    if (truncated) break
    const byId = new Map(section.nodes.map((node) => [node.nodeId, node]))
    let base = 0
    if (section.header) {
      if (lines.length >= MAX_LINES) {
        truncated = true
        break
      }
      lines.push(`- frame ${JSON.stringify(section.header.url)} [frame=${section.header.label}]`)
      base = 1
    }

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
          refs.set(ref, {
            backendNodeId: node.backendDOMNodeId,
            ...(section.sessionId !== undefined ? { sessionId: section.sessionId } : {}),
            ...(section.frameId !== undefined ? { frameId: section.frameId } : {}),
          })
          line += ` [ref=${ref}]`
        }
        lines.push(line)
      }
      for (const id of node.childIds ?? []) {
        const child = byId.get(id)
        if (child) visit(child, skip ? depth : depth + 1)
      }
    }

    for (const node of section.nodes) if (!node.parentId || !byId.has(node.parentId)) visit(node, base)
  }
  if (truncated) lines.push('… truncated')
  return { text: lines.join('\n'), refs, generation, last: n }
}
