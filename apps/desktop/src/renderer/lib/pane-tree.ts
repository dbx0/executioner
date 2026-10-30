// Pure binary tree of panes. A leaf holds one item (or nothing, showing the picker);
// a split divides its rect between two children. Every function returns new objects.

export interface ItemRef {
  kind: string
  id: string
}

/** The drag-and-drop data type carrying an `ItemRef` as JSON (a tab dragged onto a pane edge). */
export const ITEM_DRAG_TYPE = 'application/x-exe-item'

export const itemKey = (r: ItemRef): string => `${r.kind}:${r.id}`

export type PaneNode =
  | { type: 'leaf'; id: string; item: ItemRef | null }
  | { type: 'split'; dir: 'row' | 'col'; ratio: number; a: PaneNode; b: PaneNode }

/** Fractions 0..1 of the host. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const MIN_RATIO = 0.1
const MAX_RATIO = 0.9
const DIVIDER_THICKNESS = 0.006

let nextLeaf = 0
function newLeafId(): string {
  nextLeaf += 1
  return `pane-${Date.now().toString(36)}-${nextLeaf.toString(36)}`
}

export function leaf(item: ItemRef | null, id: string = newLeafId()): PaneNode {
  return { type: 'leaf', id, item }
}

function mapLeaf(node: PaneNode, leafId: string, fn: (l: Extract<PaneNode, { type: 'leaf' }>) => PaneNode): PaneNode {
  if (node.type === 'leaf') return node.id === leafId ? fn(node) : node
  return { ...node, a: mapLeaf(node.a, leafId, fn), b: mapLeaf(node.b, leafId, fn) }
}

export function splitLeaf(
  root: PaneNode,
  leafId: string,
  dir: 'row' | 'col',
  item: ItemRef | null,
): { root: PaneNode; newLeafId: string } {
  const created = leaf(item)
  const id = created.type === 'leaf' ? created.id : ''
  const next = mapLeaf(root, leafId, (l) => ({ type: 'split', dir, ratio: 0.5, a: l, b: created }))
  return { root: next, newLeafId: id }
}

/** Swap the two sides of the split whose `b` child is the leaf `leafId`, mirroring its ratio. */
export function swapSplit(root: PaneNode, leafId: string): PaneNode {
  if (root.type === 'leaf') return root
  if (root.b.type === 'leaf' && root.b.id === leafId) return { ...root, ratio: 1 - root.ratio, a: root.b, b: root.a }
  return { ...root, a: swapSplit(root.a, leafId), b: swapSplit(root.b, leafId) }
}

export function removeLeaf(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root
  const a = removeLeaf(root.a, leafId)
  const b = removeLeaf(root.b, leafId)
  if (a === null) return b
  if (b === null) return a
  return { ...root, a, b }
}

export function setLeafItem(root: PaneNode, leafId: string, item: ItemRef | null): PaneNode {
  return mapLeaf(root, leafId, (l) => ({ ...l, item }))
}

export function leaves(root: PaneNode): { id: string; item: ItemRef | null }[] {
  if (root.type === 'leaf') return [{ id: root.id, item: root.item }]
  return [...leaves(root.a), ...leaves(root.b)]
}

export function findLeafByItem(root: PaneNode, item: ItemRef): string | null {
  const key = itemKey(item)
  for (const l of leaves(root)) {
    if (l.item && itemKey(l.item) === key) return l.id
  }
  return null
}

function containsLeaf(node: PaneNode, leafId: string): boolean {
  if (node.type === 'leaf') return node.id === leafId
  return containsLeaf(node.a, leafId) || containsLeaf(node.b, leafId)
}

export function setRatio(root: PaneNode, leafIdInA: string, ratio: number): PaneNode {
  if (root.type === 'leaf') return root
  if (containsLeaf(root.a, leafIdInA)) {
    // The nearest ancestor wins: a deeper split whose `a` holds the leaf takes it first.
    const inner = setRatio(root.a, leafIdInA, ratio)
    if (inner !== root.a) return { ...root, a: inner }
    return { ...root, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) }
  }
  const inner = setRatio(root.b, leafIdInA, ratio)
  return inner === root.b ? root : { ...root, b: inner }
}

function childRects(root: Extract<PaneNode, { type: 'split' }>, rect: Rect): [Rect, Rect] {
  if (root.dir === 'row') {
    const aw = rect.w * root.ratio
    return [
      { x: rect.x, y: rect.y, w: aw, h: rect.h },
      { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h },
    ]
  }
  const ah = rect.h * root.ratio
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: ah },
    { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah },
  ]
}

export function rects(root: PaneNode): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const walk = (node: PaneNode, rect: Rect): void => {
    if (node.type === 'leaf') {
      out.set(node.id, rect)
      return
    }
    const [ra, rb] = childRects(node, rect)
    walk(node.a, ra)
    walk(node.b, rb)
  }
  walk(root, { x: 0, y: 0, w: 1, h: 1 })
  return out
}

// The last leaf of `a` is never in the `a` of a split nested inside `a`, so setRatio with it
// always lands on the divider's own split.
function lastLeafId(node: PaneNode): string {
  return node.type === 'leaf' ? node.id : lastLeafId(node.b)
}

export function dividers(root: PaneNode): { leafIdInA: string; dir: 'row' | 'col'; rect: Rect }[] {
  const out: { leafIdInA: string; dir: 'row' | 'col'; rect: Rect }[] = []
  const walk = (node: PaneNode, rect: Rect): void => {
    if (node.type === 'leaf') return
    const [ra, rb] = childRects(node, rect)
    const half = DIVIDER_THICKNESS / 2
    const line: Rect =
      node.dir === 'row'
        ? { x: rb.x - half, y: rect.y, w: DIVIDER_THICKNESS, h: rect.h }
        : { x: rect.x, y: rb.y - half, w: rect.w, h: DIVIDER_THICKNESS }
    out.push({ leafIdInA: lastLeafId(node.a), dir: node.dir, rect: line })
    walk(node.a, ra)
    walk(node.b, rb)
  }
  walk(root, { x: 0, y: 0, w: 1, h: 1 })
  return out
}

const EPS = 1e-9

export function neighbour(root: PaneNode, leafId: string, dir: 'left' | 'right' | 'up' | 'down'): string | null {
  const all = rects(root)
  const from = all.get(leafId)
  if (!from) return null
  const horizontal = dir === 'left' || dir === 'right'
  const cx = from.x + from.w / 2
  const cy = from.y + from.h / 2
  let best: { id: string; primary: number; cross: number } | null = null
  for (const [id, r] of all) {
    if (id === leafId) continue
    const dx = r.x + r.w / 2 - cx
    const dy = r.y + r.h / 2 - cy
    const primary = horizontal ? (dir === 'right' ? dx : -dx) : dir === 'down' ? dy : -dy
    if (primary <= EPS) continue
    const cross = Math.abs(horizontal ? dy : dx)
    // Prefer panes that sit squarely beside the source over ones that merely lie in that direction.
    const overlaps = horizontal
      ? r.y < from.y + from.h - EPS && r.y + r.h > from.y + EPS
      : r.x < from.x + from.w - EPS && r.x + r.w > from.x + EPS
    if (!overlaps) continue
    if (!best || primary < best.primary - EPS || (Math.abs(primary - best.primary) <= EPS && cross < best.cross)) {
      best = { id, primary, cross }
    }
  }
  return best ? best.id : null
}
