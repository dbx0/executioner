import { describe, expect, it } from 'vitest'
import {
  dividers,
  findLeafByItem,
  itemKey,
  leaf,
  leaves,
  neighbour,
  rects,
  removeLeaf,
  setLeafItem,
  setRatio,
  splitLeaf,
  swapSplit,
  type PaneNode,
} from './pane-tree.js'

const t1 = { kind: 'terminal', id: 't1' }
const t2 = { kind: 'terminal', id: 't2' }
const f1 = { kind: 'file', id: 'f1' }
const t3 = { kind: 'terminal', id: 't3' }

// 2x2: left column is [a over c], right column is [b over d].
function grid(): { root: PaneNode; a: string; b: string; c: string; d: string } {
  const first = leaf(t1, 'a')
  const r1 = splitLeaf(first, 'a', 'row', t2)
  const b = r1.newLeafId
  const r2 = splitLeaf(r1.root, 'a', 'col', f1)
  const c = r2.newLeafId
  const r3 = splitLeaf(r2.root, b, 'col', t3)
  return { root: r3.root, a: 'a', b, c, d: r3.newLeafId }
}

describe('pane-tree', () => {
  it('itemKey joins kind and id', () => {
    expect(itemKey(t1)).toBe('terminal:t1')
  })

  it('a single leaf fills the host', () => {
    expect(rects(leaf(t1, 'a')).get('a')).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('a 2-level split gives the right rects', () => {
    const one = splitLeaf(leaf(t1, 'a'), 'a', 'row', t2)
    const two = splitLeaf(one.root, one.newLeafId, 'col', f1)
    const r = rects(two.root)
    expect(r.get('a')).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(r.get(one.newLeafId)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    expect(r.get(two.newLeafId)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('splitLeaf keeps the existing leaf in a and does not mutate', () => {
    const root = leaf(t1, 'a')
    const out = splitLeaf(root, 'a', 'col', null)
    expect(root).toEqual({ type: 'leaf', id: 'a', item: t1 })
    expect(out.root).toMatchObject({ type: 'split', dir: 'col', ratio: 0.5 })
    expect(leaves(out.root).map((l) => l.item)).toEqual([t1, null])
    expect(out.newLeafId).not.toBe('a')
  })

  it('removeLeaf collapses the parent', () => {
    const { root, a, b } = grid()
    const out = removeLeaf(root, b)
    expect(out).not.toBeNull()
    expect(leaves(out as PaneNode).map((l) => l.id)).not.toContain(b)
    expect(leaves(out as PaneNode)).toHaveLength(3)
    const one = splitLeaf(leaf(t1, 'a'), 'a', 'row', t2)
    expect(removeLeaf(one.root, one.newLeafId)).toEqual({ type: 'leaf', id: a, item: t1 })
  })

  it('removing the only leaf returns null', () => {
    expect(removeLeaf(leaf(t1, 'a'), 'a')).toBeNull()
  })

  it('setLeafItem replaces the item of one leaf', () => {
    const one = splitLeaf(leaf(t1, 'a'), 'a', 'row', null)
    const out = setLeafItem(one.root, one.newLeafId, t2)
    expect(leaves(out).map((l) => l.item)).toEqual([t1, t2])
  })

  it('findLeafByItem finds a leaf or returns null', () => {
    const { root, c } = grid()
    expect(findLeafByItem(root, f1)).toBe(c)
    expect(findLeafByItem(root, { kind: 'file', id: 'nope' })).toBeNull()
  })

  it('setRatio clamps to [0.1, 0.9]', () => {
    const one = splitLeaf(leaf(t1, 'a'), 'a', 'row', t2)
    expect(rects(setRatio(one.root, 'a', 0.01)).get('a')?.w).toBeCloseTo(0.1)
    expect(rects(setRatio(one.root, 'a', 5)).get('a')?.w).toBeCloseTo(0.9)
    expect(rects(setRatio(one.root, 'a', 0.3)).get('a')?.w).toBeCloseTo(0.3)
  })

  it('setRatio targets the nearest ancestor whose a subtree holds the leaf', () => {
    const { root, a, b, c } = grid()
    const inner = rects(setRatio(root, a, 0.25))
    expect(inner.get(a)?.h).toBeCloseTo(0.25)
    expect(inner.get(c)?.h).toBeCloseTo(0.75)
    expect(inner.get(b)?.h).toBeCloseTo(0.5)
    expect(inner.get(a)?.w).toBeCloseTo(0.5)
    // c is only ever in a `b` of the left column, so the nearest ancestor with it in `a` is the root.
    const outer = rects(setRatio(root, c, 0.25))
    expect(outer.get(a)?.w).toBeCloseTo(0.25)
    expect(outer.get(a)?.h).toBeCloseTo(0.5)
  })

  it('neighbour walks a 2x2 grid', () => {
    const { root, a, b, c, d } = grid()
    expect(neighbour(root, a, 'right')).toBe(b)
    expect(neighbour(root, a, 'down')).toBe(c)
    expect(neighbour(root, d, 'left')).toBe(c)
    expect(neighbour(root, d, 'up')).toBe(b)
    expect(neighbour(root, a, 'left')).toBeNull()
    expect(neighbour(root, a, 'up')).toBeNull()
    expect(neighbour(root, d, 'right')).toBeNull()
    expect(neighbour(root, d, 'down')).toBeNull()
  })

  it('dividers count equals the number of splits', () => {
    expect(dividers(leaf(t1, 'a'))).toHaveLength(0)
    const { root } = grid()
    expect(dividers(root)).toHaveLength(3)
  })

  it('setRatio with a divider leafIdInA resizes exactly that divider split', () => {
    const split = (dir: 'row' | 'col', a: PaneNode, b: PaneNode): PaneNode => ({ type: 'split', dir, ratio: 0.5, a, b })
    const trees: PaneNode[] = [
      split('row', split('col', leaf(t1, 'A'), leaf(t2, 'B')), leaf(f1, 'C')),
      split(
        'col',
        split('row', leaf(t1, 'A'), leaf(t2, 'B')),
        split('row', leaf(f1, 'C'), leaf(t3, 'D')),
      ),
      grid().root,
    ]
    const ratios = (n: PaneNode): number[] => (n.type === 'leaf' ? [] : [n.ratio, ...ratios(n.a), ...ratios(n.b)])
    for (const root of trees) {
      const before = dividers(root)
      const beforeRatios = ratios(root)
      expect(beforeRatios).toHaveLength(before.length)
      for (let i = 0; i < before.length; i++) {
        const out = setRatio(root, before[i]!.leafIdInA, 0.3)
        // dividers() and ratios() both walk splits in preorder, so index i is the same split.
        const expected = beforeRatios.map((r, k) => (k === i ? 0.3 : r))
        expect(ratios(out)).toEqual(expected)
      }
    }
  })

  it('a divider sits on the split boundary', () => {
    const one = splitLeaf(leaf(t1, 'a'), 'a', 'row', t2)
    const list = dividers(one.root)
    expect(list).toHaveLength(1)
    const d = list[0]!
    expect(d.leafIdInA).toBe('a')
    expect(d.dir).toBe('row')
    expect(d.rect.x + d.rect.w / 2).toBeCloseTo(0.5)
    expect(d.rect.y).toBe(0)
    expect(d.rect.h).toBe(1)
  })

  it('swapSplit puts the new leaf first and mirrors the ratio', () => {
    const one = splitLeaf(leaf(t1, 'a'), 'a', 'row', t2)
    const resized = setRatio(one.root, 'a', 0.3)
    const out = swapSplit(resized, one.newLeafId)
    expect(leaves(out).map((p) => p.id)).toEqual([one.newLeafId, 'a'])
    expect(out.type === 'split' && out.ratio).toBeCloseTo(0.7)
    expect(rects(out).get(one.newLeafId)).toEqual(expect.objectContaining({ x: 0 }))
  })

  it('swapSplit swaps a split nested inside another and leaves the outer one alone', () => {
    const outer = splitLeaf(leaf(t1, 'a'), 'a', 'row', t2)
    const inner = splitLeaf(outer.root, outer.newLeafId, 'col', t3)
    const ratios = (n: PaneNode): number[] => (n.type === 'leaf' ? [] : [n.ratio, ...ratios(n.a), ...ratios(n.b)])
    const resized = setRatio(inner.root, outer.newLeafId, 0.3)
    const out = swapSplit(resized, inner.newLeafId)
    expect(leaves(out).map((p) => p.id)).toEqual(['a', inner.newLeafId, outer.newLeafId])
    expect(ratios(out)).toEqual([ratios(resized)[0], 0.7])
    expect(out.type === 'split' && out.a).toEqual(resized.type === 'split' && resized.a)
  })

  it('swapSplit leaves a tree without that leaf as it was', () => {
    const one = splitLeaf(leaf(t1, 'a'), 'a', 'row', t2)
    expect(swapSplit(one.root, 'nope')).toEqual(one.root)
    expect(swapSplit(leaf(t1, 'a'), 'a')).toEqual(leaf(t1, 'a'))
  })
})
