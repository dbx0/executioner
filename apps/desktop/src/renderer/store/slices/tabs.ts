import { fileWithFlags, nextFileId, tabMetaKey } from '../helpers.js'
import type { AppState, FileTab, Session, TabMeta } from '../types.js'
import type { SliceCtx } from './context.js'
import { withoutEditorStateFor } from './editor.js'
import { activateItem, bulkCloseTargets, dropItem, healLayouts, layoutOf, placeItem, relayout, type BulkClose } from './layouts.js'
import { disposeClosedEditorTabsIfRegistered } from '../../components/workspace/editor/tab-disposal.js'

/** The unified workspace tab strip: file tabs, selection, rename, pin/color, bulk close. */
export function createTabsSlice(ctx: SliceCtx): Pick<AppState, 'openFile' | 'promoteFileTab' | 'setFileDirty' | 'closeFile' | 'setActiveTab' | 'renameTab' | 'toggleTabPin' | 'setTabColor' | 'requestTabRename' | 'clearTabRename' | 'closeOtherTabs' | 'closeTabsToRight' | 'closeTabsToLeft'> {
  const { set, get, patchActive, persistSessions, persistFiles, persistTabMeta, persistEditorState } =
    ctx

  // Pinned layouts survive every bulk close.
  const closeBulk = (tab: Parameters<AppState['closeOtherTabs']>[0], which: BulkClose): void => {
    patchActive(healLayouts)
    const { layouts, tabMeta } = get()
    const from = layoutOf({ layouts }, tab)?.id
    if (from === undefined) return
    for (const l of bulkCloseTargets(layouts, tabMeta, from, which)) get().closeLayout(l.id)
  }

  return {
    openFile: (path, name, opts) => {
      const preview = opts?.preview === true
      patchActive((e) =>
        relayout(e, (x) => {
          const existing = x.files.find((f) => f.path === path)
          if (existing !== undefined) {
            // The file is already open. A preview-open just re-activates it; a
            // permanent open (double-click) promotes it out of preview.
            const files =
              preview || existing.preview !== true
                ? x.files
                : x.files.map((f) => (f.id === existing.id ? fileWithFlags(f, { preview: false }) : f))
            return placeItem({ ...x, files }, { kind: 'file', id: existing.id }, opts?.into)
          }
          if (preview) {
            // Reuse the single preview slot, if one exists, rather than opening a
            // second preview tab — its path/name (and content) change in place.
            const slot = x.files.find((f) => f.preview === true)
            if (slot !== undefined) {
              const files = x.files.map((f) => (f.id === slot.id ? { id: f.id, path, name, preview: true } : f))
              return placeItem({ ...x, files }, { kind: 'file', id: slot.id }, opts?.into)
            }
            const file: FileTab = { id: nextFileId(), path, name, preview: true }
            return placeItem({ ...x, files: [...x.files, file] }, { kind: 'file', id: file.id }, opts?.into)
          }
          const file: FileTab = { id: nextFileId(), path, name }
          return placeItem({ ...x, files: [...x.files, file] }, { kind: 'file', id: file.id }, opts?.into)
        }),
      )
      persistFiles(get().activeRoot)
      set({ activeView: 'terminals' })
    },

    promoteFileTab: (id) => {
      patchActive((e) => {
        if (!e.files.some((f) => f.id === id && f.preview === true)) return e
        const files = e.files.map((f) => (f.id === id ? fileWithFlags(f, { preview: false }) : f))
        return { ...e, files }
      })
      persistFiles(get().activeRoot)
    },

    setFileDirty: (id, dirty) => {
      patchActive((e) => {
        if (!e.files.some((f) => f.id === id && (f.dirty === true) !== dirty)) return e
        const files = e.files.map((f) => (f.id === id ? fileWithFlags(f, { dirty }) : f))
        return { ...e, files }
      })
    },

    closeFile: (id) => {
      // Captured before the tab leaves the list: its path is how the retained
      // Monaco model is looked up, and `keepCurrentModel` means nothing else
      // would ever dispose it.
      const closing = get().files.find((f) => f.id === id)
      patchActive((e0) => {
        const e = healLayouts(e0)
        if (!e.files.some((f) => f.id === id)) return e
        const files = e.files.filter((f) => f.id !== id)
        // The pane goes with the file; the layout code picks what to show next.
        const dropped = relayout({ ...e, files }, (x) => dropItem(x, { kind: 'file', id }))
        return { ...dropped, ...withoutEditorStateFor(e, id) }
      })
      if (closing !== undefined) {
        disposeClosedEditorTabsIfRegistered([{ id: closing.id, path: closing.path }])
      }
      persistFiles(get().activeRoot)
      persistTabMeta(get().activeRoot)
      persistEditorState(get().activeRoot)
    },

    setActiveTab: (tab) => patchActive((e) => relayout(e, (x) => activateItem(x, tab))),

    renameTab: (tab, title) => {
      const trimmed = title.trim()
      patchActive((e) => {
        if (tab.kind === 'terminal') {
          const sessions = e.sessions.map((s) => {
            if (s.id !== tab.id) return s
            const next: Session = { id: s.id, label: s.label, agent: s.agent }
            if (s.resume !== undefined && s.resume !== '') next.resume = s.resume
            // Empty title reverts to the default (label); otherwise store it.
            if (trimmed !== '') next.title = trimmed
            return next
          })
          return { ...e, sessions }
        }
        const files = e.files.map((f) => {
          if (f.id !== tab.id) return f
          const next: FileTab = { id: f.id, path: f.path, name: f.name }
          if (trimmed !== '') next.title = trimmed
          if (f.preview === true) next.preview = true
          if (f.dirty === true) next.dirty = true
          return next
        })
        return { ...e, files }
      })
      if (tab.kind === 'terminal') persistSessions(get().activeRoot)
      else persistFiles(get().activeRoot)
    },

    toggleTabPin: (tab) => {
      patchActive((e0) => {
        const e = healLayouts(e0)
        // Pin and colour belong to the layout, which a tab in a split resolves to.
        const key = layoutOf(e, tab)?.id ?? tabMetaKey(tab)
        const cur = e.tabMeta[key] ?? {}
        // exactOptionalPropertyTypes: build the next entry with only set keys.
        const next: TabMeta = {}
        if (cur.pinned !== true) next.pinned = true
        if (cur.color !== undefined) next.color = cur.color
        const tabMeta = { ...e.tabMeta }
        if (next.pinned === undefined && next.color === undefined) delete tabMeta[key]
        else tabMeta[key] = next
        return { ...e, tabMeta }
      })
      persistTabMeta(get().activeRoot)
    },

    setTabColor: (tab, color) => {
      patchActive((e0) => {
        const e = healLayouts(e0)
        // Pin and colour belong to the layout, which a tab in a split resolves to.
        const key = layoutOf(e, tab)?.id ?? tabMetaKey(tab)
        const cur = e.tabMeta[key] ?? {}
        const next: TabMeta = {}
        if (cur.pinned === true) next.pinned = true
        if (color !== undefined && color !== '') next.color = color
        const tabMeta = { ...e.tabMeta }
        if (next.pinned === undefined && next.color === undefined) delete tabMeta[key]
        else tabMeta[key] = next
        return { ...e, tabMeta }
      })
      persistTabMeta(get().activeRoot)
    },

    requestTabRename: (tab) => set({ renameRequest: tab }),
    clearTabRename: () => set({ renameRequest: null }),

    closeOtherTabs: (tab) => closeBulk(tab, 'others'),
    closeTabsToRight: (tab) => closeBulk(tab, 'right'),
    closeTabsToLeft: (tab) => closeBulk(tab, 'left'),
  }
}
