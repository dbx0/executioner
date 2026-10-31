import { browsersApi } from '../../api/browsers.js'
import { notifyUser } from '../../lib/notify.js'
import type { ItemRef } from '../../lib/pane-tree.js'
import { notify } from '../../lib/toast.js'
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
  const { [id]: _ask, ...browserAsks } = e.browserAsks
  const browsers = e.browsers.filter((b) => b.id !== id)
  // The pane goes with the browser; the layout code picks what to show next.
  return relayout({ ...e, browsers, browserActivity, browserAsks }, (x) => dropItem(x, refOf(id)))
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
): Pick<AppState, 'openBrowser' | 'closeBrowser' | 'setBrowserOwner' | 'handleBrowserEvent' | 'showBrowser' | 'syncBrowsers' | 'answerBrowserAsk' | 'trackBrowserPage'> {
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

  /** Drop a browser's ask signal locally; the engine has it answered already, or is told separately. */
  const withoutAsk = (e: OpenEngagement, id: string): OpenEngagement => {
    if (!(id in e.browserAsks)) return e
    const { [id]: _drop, ...browserAsks } = e.browserAsks
    return { ...e, browserAsks }
  }

  const applyEvent = (root: string, event: BrowserEvent, item: BrowserTab & { active?: boolean; message?: string }): void => {
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
      case 'ask': {
        const message = item.message ?? ''
        // Only the signal: the tab and the engagement the operator is on stay where they are.
        patchRoot(root, (e) =>
          e.browsers.some((b) => b.id === item.id) ? { ...e, browserAsks: { ...e.browserAsks, [item.id]: message } } : e,
        )
        const engagement = get().open.find((e) => e.root === root)
        const owner = engagement?.sessions.find((x) => x.id === item.owner)
        const label = owner === undefined ? 'An agent' : (owner.title ?? owner.label)
        // An ask from an engagement in the background names it, since its rail badge is all that shows.
        const where = root === get().activeRoot || engagement === undefined ? '' : ` in ${engagement.name}`
        const title = `${label} needs you in the browser${where}`
        const show = (): void => get().showBrowser(root, item.id)
        notify.attention({ who: label, text: `is waiting on you in the browser${where}`, description: message, action: { label: 'Show', onClick: show } })
        if (!document.hasFocus()) notifyUser(title, message, show)
        break
      }
      case 'answered':
        patchRoot(root, (e) => withoutAsk(e, item.id))
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

    handleBrowserEvent: (event, item, root) => {
      const target = root ?? get().activeRoot
      if (target !== null) applyEvent(target, event, item)
    },

    showBrowser: (root, id) => {
      const e = get().open.find((x) => x.root === root)
      if (e === undefined || !e.browsers.some((b) => b.id === id)) return
      if (get().activeRoot !== root) get().switchEngagement(root)
      set({ activeView: 'terminals' })
      get().setActiveTab({ kind: 'browser', id })
    },

    trackBrowserPage: (id, url, title) => {
      // The blank page a new or rebuilt view starts on is not a place to come back to.
      if (url === '' || url === 'about:blank') return
      const e = get().open.find((x) => x.browsers.some((b) => b.id === id && (b.url !== url || b.title !== title)))
      if (e === undefined) return
      patchRoot(e.root, (x) => ({ ...x, browsers: x.browsers.map((b) => (b.id === id ? { ...b, url, title } : b)) }))
      persistBrowsers(e.root)
    },

    answerBrowserAsk: async (id, reply) => {
      const { client, activeRoot: root } = get()
      if (client === null || root === null) return
      try {
        await browsersApi(client).answer(id, reply)
      } catch (e) {
        // 409 means nothing is pending any more (answered elsewhere, or the agent's
        // browser went away), so the signal is stale either way; anything else is a
        // real failure and the agent is still waiting.
        if ((e as { response?: { status?: number } }).response?.status !== 409) {
          set({ error: (e as Error).message })
          return
        }
      }
      patchRoot(root, (e) => withoutAsk(e, id))
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
        // A pending ask is state on the engine, so an engagement that missed the event
        // (it was not the active one) shows it on activation; no new notification.
        patchRoot(root, (e) => {
          const browserAsks: Record<string, string> = {}
          for (const item of items) {
            if (item.ask !== undefined && e.browsers.some((b) => b.id === item.id)) browserAsks[item.id] = item.ask.message
          }
          const same =
            Object.keys(browserAsks).length === Object.keys(e.browserAsks).length &&
            Object.entries(browserAsks).every(([k, v]) => e.browserAsks[k] === v)
          return same ? e : { ...e, browserAsks }
        })
        persistBrowsers(root)
      } catch {
        /* the engine may be starting; the next activation syncs again */
      }
    },
  }
}
