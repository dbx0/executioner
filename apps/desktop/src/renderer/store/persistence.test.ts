import { beforeEach, describe, expect, it } from 'vitest'
import { leaf, leaves, splitLeaf, type ItemRef, type PaneNode } from '../lib/pane-tree.js'
import { loadLayouts, saveLayouts } from './persistence.js'
import { reconcileLayouts } from './slices/layouts.js'
import type { Layout } from './types.js'

const ROOT = '/r'
const t = (id: string): ItemRef => ({ kind: 'terminal', id })
const f = (id: string): ItemRef => ({ kind: 'file', id })

function splitLayout(a: ItemRef, b: ItemRef): Layout {
  const first = leaf(a, 'la')
  const { root } = splitLeaf(first, 'la', 'row', b)
  return { id: `${a.kind}:${a.id}`, root, focusedLeafId: 'la' }
}

describe('layout persistence', () => {
  beforeEach(() => localStorage.clear())

  it('old state with no layouts becomes one layout per item in strip order', () => {
    expect(loadLayouts(ROOT)).toBeNull()
    const items = [t('s1'), t('s2'), f('f1')]
    const { layouts, activeLayoutId } = reconcileLayouts(null, items, { kind: 'terminal', id: 's2' })
    expect(layouts.map((l) => l.id)).toEqual(['terminal:s1', 'terminal:s2', 'file:f1'])
    for (const l of layouts) expect(leaves(l.root)).toHaveLength(1)
    expect(layouts.map((l) => leaves(l.root)[0]?.item)).toEqual(items)
    expect(layouts.every((l) => leaves(l.root)[0]?.id === l.focusedLeafId)).toBe(true)
    expect(activeLayoutId).toBe('terminal:s2')
  })

  it('a saved split survives a round trip', () => {
    const split = splitLayout(t('s1'), f('f1'))
    saveLayouts(ROOT, [split, { id: 'terminal:s2', root: leaf(t('s2'), 'lb'), focusedLeafId: 'lb' }], 'terminal:s2')
    const saved = loadLayouts(ROOT)
    expect(saved?.activeLayoutId).toBe('terminal:s2')
    const { layouts, activeLayoutId } = reconcileLayouts(
      saved?.layouts ?? null,
      [t('s1'), t('s2'), f('f1')],
      { kind: 'terminal', id: 's1' },
      saved?.activeLayoutId,
    )
    expect(layouts).toHaveLength(2)
    expect(layouts[0]).toEqual(split)
    expect(activeLayoutId).toBe('terminal:s2')
  })

  it('leaves for missing items are dropped and their splits collapse', () => {
    const split = splitLayout(t('s1'), t('dead'))
    const gone = splitLayout(t('x'), f('y'))
    const { layouts, activeLayoutId } = reconcileLayouts(
      [split, gone],
      [t('s1'), t('s3')],
      null,
      'terminal:x',
    )
    expect(layouts.map((l) => l.id)).toEqual(['terminal:s1', 'terminal:s3'])
    expect(layouts[0]?.root.type).toBe('leaf')
    expect(leaves(layouts[0]?.root ?? leaf(null)).map((p) => p.item)).toEqual([t('s1')])
    expect(layouts[0]?.focusedLeafId).toBe('la')
    expect(activeLayoutId).toBe('terminal:s1')
  })

  it('fixes a focus that points at a dropped leaf', () => {
    const split = splitLayout(t('s1'), t('s2'))
    const [, second] = leaves(split.root)
    const { layouts } = reconcileLayouts([{ ...split, focusedLeafId: second?.id ?? '' }], [t('s1')], null)
    expect(layouts[0]?.focusedLeafId).toBe('la')
  })

  it('garbage in storage is ignored', () => {
    localStorage.setItem(`exe.layouts:${ROOT}`, '{not json')
    expect(loadLayouts(ROOT)).toBeNull()
    localStorage.setItem(`exe.layouts:${ROOT}`, JSON.stringify({ layouts: 'nope', activeLayoutId: 4 }))
    expect(loadLayouts(ROOT)).toBeNull()
    localStorage.setItem(
      `exe.layouts:${ROOT}`,
      JSON.stringify({
        layouts: [
          null,
          { id: 'a', root: { type: 'leaf' }, focusedLeafId: 'x' },
          { id: 'ok', root: { type: 'leaf', id: 'l1', item: { kind: 'terminal', id: 's1' } }, focusedLeafId: 'l1' },
        ],
        activeLayoutId: 7,
      }),
    )
    const saved = loadLayouts(ROOT)
    expect(saved?.layouts.map((l) => l.id)).toEqual(['ok'])
    expect(saved?.activeLayoutId).toBeNull()
  })

  it('an item held twice under one leaf id still ends in exactly one pane', () => {
    const dup: Layout = {
      id: 'x',
      root: { type: 'split', dir: 'row', ratio: 0.5, a: leaf(t('s1'), 'p'), b: leaf(t('s1'), 'p') },
      focusedLeafId: 'p',
    }
    const { layouts, activeLayoutId } = reconcileLayouts([dup], [t('s1')], null)
    expect(layouts.map((l) => leaves(l.root).map((p) => p.item))).toEqual([[t('s1')]])
    expect(activeLayoutId).toBe('x')
  })

  it('two different items sharing a leaf id get distinct leaf ids', () => {
    const clash: Layout = {
      id: 'x',
      root: { type: 'split', dir: 'row', ratio: 0.5, a: leaf(t('s1'), 'p'), b: leaf(t('s2'), 'p') },
      focusedLeafId: 'p',
    }
    const other: Layout = { id: 'y', root: leaf(f('f1'), 'p'), focusedLeafId: 'p' }
    const { layouts } = reconcileLayouts([clash, other], [t('s1'), t('s2'), f('f1')], null)
    const panes = layouts.flatMap((l) => leaves(l.root))
    expect(new Set(panes.map((p) => p.id)).size).toBe(panes.length)
    expect(panes.map((p) => p.item)).toEqual([t('s1'), t('s2'), f('f1')])
    expect(layouts[0]?.focusedLeafId).toBe('p')
  })

  it('split ratios are clamped and a non-finite one falls back to half', () => {
    // Raw JSON text: 1e999 only exists as text, JSON.stringify would write it back as null.
    const ratioOf = (literal: string): number | undefined => {
      const a = JSON.stringify({ type: 'leaf', id: 'a', item: t('s1') })
      const b = JSON.stringify({ type: 'leaf', id: 'b', item: t('s2') })
      const root = `{"type":"split","dir":"row","ratio":${literal},"a":${a},"b":${b}}`
      localStorage.setItem(
        `exe.layouts:${ROOT}`,
        `{"layouts":[{"id":"x","root":${root},"focusedLeafId":"a"}],"activeLayoutId":"x"}`,
      )
      const node: PaneNode | undefined = loadLayouts(ROOT)?.layouts[0]?.root
      return node?.type === 'split' ? node.ratio : undefined
    }
    expect(ratioOf('5')).toBe(0.9)
    expect(ratioOf('-2')).toBe(0.1)
    expect(ratioOf('0.3')).toBe(0.3)
    expect(ratioOf('1e999')).toBe(0.5)
  })

  it('keeps a layout whose saved focus is missing, so reconcile can repair it', () => {
    localStorage.setItem(
      `exe.layouts:${ROOT}`,
      JSON.stringify({
        layouts: [{ id: 'ok', root: { type: 'leaf', id: 'l1', item: t('s1') } }],
        activeLayoutId: 'ok',
      }),
    )
    const saved = loadLayouts(ROOT)
    expect(saved?.layouts.map((l) => l.id)).toEqual(['ok'])
    const { layouts } = reconcileLayouts(saved?.layouts ?? null, [t('s1')], null, saved?.activeLayoutId)
    expect(layouts[0]?.focusedLeafId).toBe('l1')
  })
})
