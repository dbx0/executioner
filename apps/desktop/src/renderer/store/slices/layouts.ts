import {
  findLeafByItem,
  itemKey,
  leaf,
  leaves,
  neighbour,
  removeLeaf,
  setLeafItem,
  setRatio,
  splitLeaf,
  swapSplit,
  type ItemRef,
  type PaneNode,
} from '../../lib/pane-tree.js'
import type { ActiveTab, AppState, Layout, OpenEngagement } from '../types.js'
import type { SliceCtx } from './context.js'

let layoutSeq = 0
function newId(): string {
  layoutSeq += 1
  return `${Date.now().toString(36)}-${layoutSeq.toString(36)}`
}

const leafIdOf = (node: PaneNode): string => (node.type === 'leaf' ? node.id : '')

function firstLeafId(node: PaneNode): string {
  return node.type === 'leaf' ? node.id : firstLeafId(node.a)
}

function lastLeafId(node: PaneNode): string {
  return node.type === 'leaf' ? node.id : lastLeafId(node.b)
}

/** The leaf that takes over the space of `leafId` when it is removed, or null. */
function siblingLeafId(node: PaneNode, leafId: string): string | null {
  if (node.type === 'leaf') return null
  if (node.a.type === 'leaf' && node.a.id === leafId) return firstLeafId(node.b)
  if (node.b.type === 'leaf' && node.b.id === leafId) return lastLeafId(node.a)
  return siblingLeafId(node.a, leafId) ?? siblingLeafId(node.b, leafId)
}

/**
 * The question to ask before closing a layout whose close would end a working agent along
 * with other panes, or null when it can just close: one pane, or no agent still working.
 */
export function closeConfirmation(
  layout: Layout,
  sessions: { id: string; agent: string }[],
  sessionState: Record<string, string>,
): string | null {
  const panes = leaves(layout.root)
  if (panes.length < 2) return null
  const working = panes.some(
    (p) =>
      p.item?.kind === 'terminal' &&
      sessionState[p.item.id] === 'working' &&
      sessions.some((s) => s.id === p.item?.id && s.agent !== 'shell'),
  )
  return working ? `Close all ${panes.length} panes? An agent is still working.` : null
}

export type BulkClose = 'others' | 'right' | 'left'

/** The unpinned layouts a bulk close from `layoutId` would close, in strip order. */
export function bulkCloseTargets(
  layouts: Layout[],
  tabMeta: Record<string, { pinned?: boolean }>,
  layoutId: string,
  which: BulkClose,
): Layout[] {
  const idx = layouts.findIndex((l) => l.id === layoutId)
  if (idx === -1) return []
  const range = which === 'others' ? layouts.filter((l) => l.id !== layoutId) : which === 'right' ? layouts.slice(idx + 1) : layouts.slice(0, idx)
  return range.filter((l) => tabMeta[l.id]?.pinned !== true)
}

/** The question to ask before a bulk close that would end a working agent in a split, or null. */
export function bulkCloseConfirmation(
  targets: Layout[],
  sessions: { id: string; agent: string }[],
  sessionState: Record<string, string>,
): string | null {
  if (!targets.some((l) => closeConfirmation(l, sessions, sessionState) !== null)) return null
  return targets.length === 1
    ? 'Close 1 tab? An agent is still working in it.'
    : `Close ${targets.length} tabs? An agent is still working in one of them.`
}

function newLayout(layouts: Layout[], item: ItemRef | null, leafId?: string): Layout {
  const key = item === null ? null : itemKey(item)
  const id = key !== null && !layouts.some((l) => l.id === key) ? key : `layout:${newId()}`
  const root = leaf(item, leafId)
  return { id, root, focusedLeafId: leafIdOf(root) }
}

function hasItem(layout: Layout, item: ItemRef): boolean {
  return findLeafByItem(layout.root, item) !== null
}

export function layoutOf(e: Pick<OpenEngagement, 'layouts'>, item: ItemRef): Layout | undefined {
  return e.layouts.find((l) => hasItem(l, item))
}

function locate(e: OpenEngagement, item: ItemRef): { layoutId: string; leafId: string } | null {
  for (const l of e.layouts) {
    const leafId = findLeafByItem(l.root, item)
    if (leafId !== null) return { layoutId: l.id, leafId }
  }
  return null
}

function focusedItem(layout: Layout): ItemRef | null {
  return leaves(layout.root).find((l) => l.id === layout.focusedLeafId)?.item ?? null
}

function updateLayout(e: OpenEngagement, layoutId: string, fn: (l: Layout) => Layout): OpenEngagement {
  return { ...e, layouts: e.layouts.map((l) => (l.id === layoutId ? fn(l) : l)) }
}

/**
 * Restore the invariant that every session and file sits in a layout: any that does not gets
 * a single-pane layout at the end, and the active layout is one that exists.
 */
export function healLayouts(e: OpenEngagement): OpenEngagement {
  const present = new Set<string>()
  for (const l of e.layouts) {
    for (const p of leaves(l.root)) if (p.item !== null) present.add(itemKey(p.item))
  }
  const items: ItemRef[] = [
    ...e.sessions.map((s) => ({ kind: 'terminal', id: s.id })),
    ...e.files.map((f) => ({ kind: 'file', id: f.id })),
    ...e.browsers.map((b) => ({ kind: 'browser', id: b.id })),
  ]
  let layouts = e.layouts
  for (const item of items) {
    if (!present.has(itemKey(item))) layouts = [...layouts, newLayout(layouts, item)]
  }
  let activeLayoutId = e.activeLayoutId
  if (activeLayoutId === null || !layouts.some((l) => l.id === activeLayoutId)) {
    const tab = e.activeTab
    const byTab = tab === null ? undefined : layouts.find((l) => hasItem(l, tab))
    activeLayoutId = (byTab ?? layouts[0])?.id ?? null
  }
  if (layouts === e.layouts && activeLayoutId === e.activeLayoutId) return e
  return { ...e, layouts, activeLayoutId }
}

/**
 * Turn saved layouts into ones that match the items that actually exist: leaves for missing
 * items go (their splits collapse), empty layouts go, and every item no layout holds gets a
 * single-pane layout in `items` order. With nothing saved this is the old tab strip, one
 * layout per item. `savedActiveId` is the active layout that was saved alongside them.
 */
export function reconcileLayouts(
  saved: Layout[] | null,
  items: ItemRef[],
  activeTab: ActiveTab | null,
  savedActiveId?: string | null,
): { layouts: Layout[]; activeLayoutId: string | null } {
  const known = new Set(items.map(itemKey))
  const seen = new Set<string>()
  const usedLeafIds = new Set<string>()
  // Rebuild a tree keeping each live item once and every leaf id unique across all layouts: a
  // missing or repeated item goes (its split collapses), a repeated leaf id is replaced by a new one.
  const prune = (node: PaneNode): PaneNode | null => {
    if (node.type === 'leaf') {
      if (node.item !== null) {
        const key = itemKey(node.item)
        if (!known.has(key) || seen.has(key)) return null
        seen.add(key)
      }
      const id = usedLeafIds.has(node.id) ? leafIdOf(leaf(null)) : node.id
      usedLeafIds.add(id)
      return { type: 'leaf', id, item: node.item }
    }
    const a = prune(node.a)
    const b = prune(node.b)
    if (a === null) return b
    if (b === null) return a
    return { ...node, a, b }
  }
  const layouts: Layout[] = []
  for (const l of saved ?? []) {
    if (layouts.some((x) => x.id === l.id)) continue
    const root = prune(l.root)
    if (root === null || leaves(root).every((p) => p.item === null)) continue
    const panes = leaves(root)
    const focusedLeafId = panes.some((p) => p.id === l.focusedLeafId) ? l.focusedLeafId : (panes[0]?.id ?? '')
    layouts.push({ id: l.id, root, focusedLeafId })
  }
  for (const item of items) {
    if (!seen.has(itemKey(item))) layouts.push(newLayout(layouts, item))
  }
  const byTab = activeTab === null ? undefined : layouts.find((l) => hasItem(l, activeTab))
  const active = layouts.find((l) => l.id === savedActiveId) ?? byTab ?? layouts[0]
  return { layouts, activeLayoutId: active?.id ?? null }
}

/** `activeTab` always mirrors the focused item of the active layout (null for an empty pane). */
export function syncActive(e: OpenEngagement): OpenEngagement {
  const layout = e.layouts.find((l) => l.id === e.activeLayoutId)
  const item = layout === undefined ? null : focusedItem(layout)
  let activeTab: ActiveTab | null = null
  if (item?.kind === 'terminal') activeTab = { kind: 'terminal', id: item.id }
  else if (item?.kind === 'file') activeTab = { kind: 'file', id: item.id }
  else if (item?.kind === 'browser') activeTab = { kind: 'browser', id: item.id }
  return {
    ...e,
    activeTab,
    activeSessionId: activeTab?.kind === 'terminal' ? activeTab.id : e.activeSessionId,
  }
}

/** Heal, apply, then re-sync the active tab: the shape of every layout-changing patch. */
export function relayout(e: OpenEngagement, fn: (e: OpenEngagement) => OpenEngagement): OpenEngagement {
  return syncActive(fn(healLayouts(e)))
}

export function activateItem(e: OpenEngagement, item: ItemRef): OpenEngagement {
  const at = locate(e, item)
  if (at === null) return e
  return { ...updateLayout(e, at.layoutId, (l) => ({ ...l, focusedLeafId: at.leafId })), activeLayoutId: at.layoutId }
}

/** Remove a whole layout; when it was the active one, the left neighbour (else the right) takes over. */
function removeLayout(e: OpenEngagement, layoutId: string): OpenEngagement {
  const idx = e.layouts.findIndex((l) => l.id === layoutId)
  if (idx === -1) return e
  const layouts = e.layouts.filter((l) => l.id !== layoutId)
  const { [layoutId]: _dropMeta, ...tabMeta } = e.tabMeta
  const activeLayoutId =
    e.activeLayoutId === layoutId ? (layouts[idx - 1] ?? layouts[idx])?.id ?? null : e.activeLayoutId
  return { ...e, layouts, tabMeta, activeLayoutId }
}

/** Remove one pane. The layout goes with its last pane (or once only empty panes remain). */
function dropLeaf(e: OpenEngagement, layoutId: string, leafId: string): OpenEngagement {
  const layout = e.layouts.find((l) => l.id === layoutId)
  if (layout === undefined) return e
  const root = removeLeaf(layout.root, leafId)
  if (root === null || leaves(root).every((p) => p.item === null)) return removeLayout(e, layoutId)
  const focusedLeafId =
    layout.focusedLeafId === leafId
      ? (siblingLeafId(layout.root, leafId) ?? firstLeafId(root))
      : layout.focusedLeafId
  return updateLayout(e, layoutId, (l) => ({ ...l, root, focusedLeafId }))
}

/** Take an item out of whatever pane holds it, and forget a pin/colour keyed by its own key. */
export function dropItem(e: OpenEngagement, item: ItemRef): OpenEngagement {
  const at = locate(e, item)
  const next = at === null ? e : dropLeaf(e, at.layoutId, at.leafId)
  const key = itemKey(item)
  if (next.layouts.some((l) => l.id === key) || next.tabMeta[key] === undefined) return next
  const { [key]: _dropMeta, ...tabMeta } = next.tabMeta
  return { ...next, tabMeta }
}

function fillLeaf(e: OpenEngagement, leafId: string, item: ItemRef): OpenEngagement {
  const layout = e.layouts.find((l) => l.id === e.activeLayoutId)
  const target = layout === undefined ? undefined : leaves(layout.root).find((p) => p.id === leafId)
  if (layout === undefined || target === undefined || target.item !== null) return e
  const old = locate(e, item)
  const filled = updateLayout(e, layout.id, (l) => ({
    ...l,
    root: setLeafItem(l.root, leafId, item),
    focusedLeafId: leafId,
  }))
  return old === null ? filled : dropLeaf(filled, old.layoutId, old.leafId)
}

function splitWith(
  e: OpenEngagement,
  layoutId: string,
  leafId: string,
  dir: 'row' | 'col',
  item: ItemRef | null,
  focusNew: boolean,
  before = false,
): OpenEngagement {
  const layout = e.layouts.find((l) => l.id === layoutId)
  if (layout === undefined || !leaves(layout.root).some((p) => p.id === leafId)) return e
  const old = item === null ? null : locate(e, item)
  // Dropping an item onto its own pane would split it away from itself.
  if (old !== null && old.layoutId === layoutId && old.leafId === leafId) return e
  const made = splitLeaf(layout.root, leafId, dir, item)
  const { newLeafId } = made
  const root = before ? swapSplit(made.root, newLeafId) : made.root
  const split = updateLayout(e, layoutId, (l) => ({
    ...l,
    root,
    focusedLeafId: focusNew ? newLeafId : l.focusedLeafId,
  }))
  return old === null ? split : dropLeaf(split, old.layoutId, old.leafId)
}

/**
 * Show an item that just joined sessions/files: into the named empty pane of the active
 * layout, else in its existing layout, else in a new layout appended to the strip.
 */
export function placeItem(e: OpenEngagement, item: ItemRef, into?: string): OpenEngagement {
  if (into !== undefined) {
    const filled = fillLeaf(e, into, item)
    if (filled !== e) return filled
  }
  if (layoutOf(e, item) !== undefined) return activateItem(e, item)
  const layout = newLayout(e.layouts, item)
  return { ...e, layouts: [...e.layouts, layout], activeLayoutId: layout.id }
}

/** Split the pane holding `item` with `newItem`, leaving the active layout and focus alone. */
export function splitItemBeside(e: OpenEngagement, item: ItemRef, dir: 'row' | 'col', newItem: ItemRef): OpenEngagement {
  const at = locate(e, item)
  return at === null ? e : splitWith(e, at.layoutId, at.leafId, dir, newItem, at.layoutId === e.activeLayoutId)
}

/** Layouts and their panes: split, fill, move, resize and focus. */
export function createLayoutsSlice(
  ctx: SliceCtx,
): Pick<
  AppState,
  | 'focusPane'
  | 'splitPane'
  | 'fillPane'
  | 'closePane'
  | 'closeLayout'
  | 'movePaneToNewTab'
  | 'setPaneRatio'
  | 'splitBeside'
  | 'moveFocus'
> {
  const { get, patchActive } = ctx

  const closeItem = (item: ItemRef): void => {
    if (item.kind === 'terminal') get().closeSession(item.id)
    else if (item.kind === 'file') get().closeFile(item.id)
    else if (item.kind === 'browser') get().closeBrowser(item.id)
  }

  return {
    focusPane: (layoutId, leafId) =>
      patchActive((e) =>
        relayout(e, (x) => {
          const layout = x.layouts.find((l) => l.id === layoutId)
          if (layout === undefined || !leaves(layout.root).some((p) => p.id === leafId)) return x
          return { ...updateLayout(x, layoutId, (l) => ({ ...l, focusedLeafId: leafId })), activeLayoutId: layoutId }
        }),
      ),

    splitPane: (leafId, dir, item, before) =>
      patchActive((e) =>
        relayout(e, (x) =>
          x.activeLayoutId === null ? x : splitWith(x, x.activeLayoutId, leafId, dir, item ?? null, true, before === true),
        ),
      ),

    fillPane: (leafId, item) => patchActive((e) => relayout(e, (x) => fillLeaf(x, leafId, item))),

    closePane: (leafId) => {
      const layout = get().layouts.find((l) => l.id === get().activeLayoutId)
      const target = layout === undefined ? undefined : leaves(layout.root).find((p) => p.id === leafId)
      if (layout === undefined || target === undefined) return
      if (target.item !== null) {
        closeItem(target.item)
        return
      }
      patchActive((e) => relayout(e, (x) => dropLeaf(x, layout.id, leafId)))
    },

    closeLayout: (layoutId) => {
      const layout = get().layouts.find((l) => l.id === layoutId)
      if (layout === undefined) return
      for (const p of leaves(layout.root)) {
        if (p.item !== null) closeItem(p.item)
      }
      // Empty panes have no item to close; the layout goes with them.
      patchActive((e) => relayout(e, (x) => removeLayout(x, layoutId)))
    },

    movePaneToNewTab: (leafId) =>
      patchActive((e) =>
        relayout(e, (x) => {
          const idx = x.layouts.findIndex((l) => l.id === x.activeLayoutId)
          const layout = x.layouts[idx]
          const target = layout === undefined ? undefined : leaves(layout.root).find((p) => p.id === leafId)
          if (layout === undefined || target === undefined || leaves(layout.root).length < 2) return x
          const without = dropLeaf(x, layout.id, leafId)
          const moved = newLayout(without.layouts, target.item, leafId)
          // The source layout can vanish when only empty panes remain; then the slot it held is next.
          const kept = without.layouts.findIndex((l) => l.id === layout.id)
          const at = kept === -1 ? idx : kept + 1
          const layouts = [...without.layouts.slice(0, at), moved, ...without.layouts.slice(at)]
          return { ...without, layouts, activeLayoutId: moved.id }
        }),
      ),

    setPaneRatio: (leafIdInA, ratio) =>
      patchActive((e) =>
        relayout(e, (x) => {
          const layout = x.layouts.find((l) => leaves(l.root).some((p) => p.id === leafIdInA))
          if (layout === undefined) return x
          return updateLayout(x, layout.id, (l) => ({ ...l, root: setRatio(l.root, leafIdInA, ratio) }))
        }),
      ),

    splitBeside: (item, dir, newItem) =>
      patchActive((e) =>
        relayout(e, (x) => splitItemBeside(x, item, dir, newItem)),
      ),

    moveFocus: (dir) =>
      patchActive((e) =>
        relayout(e, (x) => {
          const layout = x.layouts.find((l) => l.id === x.activeLayoutId)
          if (layout === undefined) return x
          const next = neighbour(layout.root, layout.focusedLeafId, dir)
          return next === null ? x : updateLayout(x, layout.id, (l) => ({ ...l, focusedLeafId: next }))
        }),
      ),
  }
}
