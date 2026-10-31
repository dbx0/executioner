import { browsersApi } from '../../api/browsers.js'
import type { ItemRef } from '../../lib/pane-tree.js'
import { mirror } from '../helpers.js'
import { saveLayouts } from '../persistence.js'
import type { AppState, BrowserTab, OpenEngagement } from '../types.js'
import type { SliceCtx } from './context.js'
import { dropItem, healLayouts, placeItem, relayout, splitItemBeside } from './layouts.js'

type BrowserEvent = Parameters<AppState['handleBrowserEvent']>[0]

const refOf = (id: string): ItemRef => ({ kind: 'browser', id })

/** Take a browser out of the engagement, with its pane and activity flag. */
function withoutBrowser(e0: OpenEngagement, id: string): OpenEngagement {
  const e = healLayouts(e0)
  if (!e.browsers.some((b) => b.id === id)) return e
  const { [id]: _drop, ...browserActivity } = e.browserActivity
  const browsers = e.browsers.filter((b) => b.id !== id)
  // The pane goes with the browser; the layout code picks what to show next.
  return relayout({ ...e, browsers, browserActivity }, (x) => dropItem(x, refOf(id)))
}

/**
 * Add a browser the engagement does not know yet. One an agent opened sits beside that agent's
 * terminal; any other lands in a new layout the user is not switched to.
 */
function withOpenedBrowser(e: OpenEngagement, item: BrowserTab): OpenEngagement {
  if (e.browsers.some((b) => b.id === item.id)) return e
  return relayout(e, (x) => {
    const added: OpenEngagement = {
      ...x,
      browsers: [...x.browsers, { id: item.id, url: item.url, title: item.title, owner: item.owner }],
    }
    if (item.owner !== null && x.sessions.some((s) => s.id === item.owner)) {
      return splitItemBeside(added, { kind: 'terminal', id: item.owner }, 'row', refOf(item.id))
    }
    // An agent opening a browser must never switch the tab the user is looking at.
    const placed = placeItem(added, refOf(item.id))
    return { ...placed, activeLayoutId: x.activeLayoutId ?? placed.activeLayoutId }
  })
}

function withOwner(e: OpenEngagement, id: string, owner: string | null): OpenEngagement {
  if (!e.browsers.some((b) => b.id === id && b.owner !== owner)) return e
  return { ...e, browsers: e.browsers.map((b) => (b.id === id ? { ...b, owner } : b)) }
}

/** Embedded browsers: open, close, hand over, and follow what the engine reports. */
export function createBrowsersSlice(
  ctx: SliceCtx,
): Pick<AppState, 'openBrowser' | 'closeBrowser' | 'setBrowserOwner' | 'handleBrowserEvent' | 'syncBrowsers'> {
  const { set, get, persistBrowsers, persistTabMeta } = ctx

  /** Patch one engagement by root, so a reply that lands after a switch never touches the active one. */
  const patchRoot = (root: string, fn: (e: OpenEngagement) => OpenEngagement): void => {
    const { open, activeRoot } = get()
    const before = open.find((e) => e.root === root)
    if (before === undefined) return
    const after = fn(before)
    if (after === before) return
    const next = open.map((e) => (e.root === root ? after : e))
    set({ open: next, ...mirror(next, activeRoot) })
    if (before.layouts !== after.layouts || before.activeLayoutId !== after.activeLayoutId)
      saveLayouts(root, after.layouts, after.activeLayoutId)
  }

  const applyEvent = (root: string, event: BrowserEvent, item: BrowserTab & { active?: boolean }): void => {
    switch (event) {
      case 'opened':
        patchRoot(root, (e) => withOpenedBrowser(e, item))
        break
      case 'owner':
        patchRoot(root, (e) => withOwner(e, item.id, item.owner))
        break
      case 'closed':
        patchRoot(root, (e) => withoutBrowser(e, item.id))
        persistTabMeta(root)
        break
      case 'activity':
        patchRoot(root, (e) =>
          e.browsers.some((b) => b.id === item.id)
            ? { ...e, browserActivity: { ...e.browserActivity, [item.id]: item.active === true } }
            : e,
        )
        break
    }
    persistBrowsers(root)
  }

  return {
    openBrowser: async (opts) => {
      const { client, activeRoot: root } = get()
      if (client === null || root === null) return
      try {
        const item = await browsersApi(client).create(opts?.url !== undefined ? { url: opts.url } : {})
        // The engine's own 'opened' event may land before or after this reply; the tab is only
        // added once, and this call is the one that activates it.
        patchRoot(root, (e) =>
          relayout(e, (x) => {
            const known = x.browsers.some((b) => b.id === item.id)
            const browsers = known ? x.browsers : [...x.browsers, { id: item.id, url: item.url, title: item.title, owner: item.owner }]
            return placeItem({ ...x, browsers }, refOf(item.id), opts?.into)
          }),
        )
        persistBrowsers(root)
        if (get().activeRoot === root) set({ activeView: 'terminals' })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    closeBrowser: (id) => {
      const { client, activeRoot: root } = get()
      if (root === null) return
      // The pane closes whether or not the engine could be told.
      if (client !== null) browsersApi(client).remove(id).catch(() => undefined)
      patchRoot(root, (e) => withoutBrowser(e, id))
      persistBrowsers(root)
      persistTabMeta(root)
    },

    setBrowserOwner: async (id, owner) => {
      const { client, activeRoot: root } = get()
      if (client === null || root === null) return
      try {
        const item = await browsersApi(client).update(id, { owner })
        patchRoot(root, (e) => withOwner(e, id, item.owner))
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    handleBrowserEvent: (event, item) => {
      const root = get().activeRoot
      if (root !== null) applyEvent(root, event, item)
    },

    syncBrowsers: async () => {
      const { client, activeRoot: root } = get()
      if (client === null || root === null) return
      // Only browsers known before the request can be forgotten by it: one added while it was in
      // flight (a restore, an open) would otherwise be dropped for not being in a stale list.
      const known = new Set((get().open.find((e) => e.root === root)?.browsers ?? []).map((b) => b.id))
      try {
        const items = await browsersApi(client).list()
        const live = new Set(items.map((i) => i.id))
        for (const id of known) {
          if (!live.has(id)) applyEvent(root, 'closed', { id, url: '', title: '', owner: null })
        }
        for (const item of items) {
          const have = get().open.find((e) => e.root === root)?.browsers.some((b) => b.id === item.id) === true
          applyEvent(root, have ? 'owner' : 'opened', item)
        }
      } catch {
        /* the engine may be starting; the next activation syncs again */
      }
    },
  }
}
