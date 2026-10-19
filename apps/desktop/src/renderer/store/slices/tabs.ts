import { fileWithFlags, nextFileId, tabMetaKey } from '../helpers.js'
import type { ActiveTab, AppState, FileTab, Session, TabMeta } from '../types.js'
import type { SliceCtx } from './context.js'
import { withoutEditorStateFor } from './editor.js'
import { disposeClosedEditorTabsIfRegistered } from '../../components/workspace/editor/tab-disposal.js'

/** The unified workspace tab strip: file tabs, selection, rename, pin/color, bulk close. */
export function createTabsSlice(ctx: SliceCtx): Pick<AppState, 'openFile' | 'promoteFileTab' | 'setFileDirty' | 'closeFile' | 'setActiveTab' | 'renameTab' | 'toggleTabPin' | 'setTabColor' | 'requestTabRename' | 'clearTabRename' | 'closeOtherTabs' | 'closeTabsToRight' | 'closeTabsToLeft'> {
  const { set, get, patchActive, persistSessions, persistFiles, persistTabMeta, persistEditorState } =
    ctx

  return {
    openFile: (path, name, opts) => {
      const preview = opts?.preview === true
      patchActive((e) => {
        const existing = e.files.find((f) => f.path === path)
        if (existing !== undefined) {
          // The file is already open. A preview-open just re-activates it; a
          // permanent open (double-click) promotes it out of preview.
          const files =
            preview || existing.preview !== true
              ? e.files
              : e.files.map((f) => (f.id === existing.id ? fileWithFlags(f, { preview: false }) : f))
          return { ...e, files, activeTab: { kind: 'file', id: existing.id } }
        }
        if (preview) {
          // Reuse the single preview slot, if one exists, rather than opening a
          // second preview tab — its path/name (and content) change in place.
          const slot = e.files.find((f) => f.preview === true)
          if (slot !== undefined) {
            const files = e.files.map((f) => (f.id === slot.id ? { id: f.id, path, name, preview: true } : f))
            return { ...e, files, activeTab: { kind: 'file', id: slot.id } }
          }
          const file: FileTab = { id: nextFileId(), path, name, preview: true }
          return { ...e, files: [...e.files, file], activeTab: { kind: 'file', id: file.id } }
        }
        const file: FileTab = { id: nextFileId(), path, name }
        return { ...e, files: [...e.files, file], activeTab: { kind: 'file', id: file.id } }
      })
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
      patchActive((e) => {
        const idx = e.files.findIndex((f) => f.id === id)
        if (idx === -1) return e
        const files = e.files.filter((f) => f.id !== id)
        let activeTab = e.activeTab
        if (e.activeTab?.kind === 'file' && e.activeTab.id === id) {
          // Prefer the neighbouring file tab, then a terminal, then nothing.
          const neighbour = files[idx] ?? files[idx - 1]
          activeTab = neighbour
            ? { kind: 'file', id: neighbour.id }
            : e.activeSessionId
              ? { kind: 'terminal', id: e.activeSessionId }
              : null
        }
        const { [tabMetaKey({ kind: 'file', id })]: _dropMeta, ...tabMeta } = e.tabMeta
        return { ...e, files, activeTab, tabMeta, ...withoutEditorStateFor(e, id) }
      })
      if (closing !== undefined) {
        disposeClosedEditorTabsIfRegistered([{ id: closing.id, path: closing.path }])
      }
      persistFiles(get().activeRoot)
      persistTabMeta(get().activeRoot)
      persistEditorState(get().activeRoot)
    },

    setActiveTab: (tab) =>
      patchActive((e) =>
        tab.kind === 'terminal'
          ? { ...e, activeSessionId: tab.id, activeTab: tab }
          : { ...e, activeTab: tab },
      ),

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
      const key = tabMetaKey(tab)
      patchActive((e) => {
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
      const key = tabMetaKey(tab)
      patchActive((e) => {
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

    closeOtherTabs: (tab) => {
      const { sessions, files, tabMeta } = get()
      const ordered: ActiveTab[] = [
        ...sessions.map((s) => ({ kind: 'terminal' as const, id: s.id })),
        ...files.map((f) => ({ kind: 'file' as const, id: f.id })),
      ]
      for (const x of ordered) {
        const same = x.kind === tab.kind && x.id === tab.id
        if (same || tabMeta[tabMetaKey(x)]?.pinned === true) continue
        if (x.kind === 'terminal') get().closeSession(x.id)
        else get().closeFile(x.id)
      }
    },

    closeTabsToRight: (tab) => {
      const { sessions, files, tabMeta } = get()
      const ordered: ActiveTab[] = [
        ...sessions.map((s) => ({ kind: 'terminal' as const, id: s.id })),
        ...files.map((f) => ({ kind: 'file' as const, id: f.id })),
      ]
      const idx = ordered.findIndex((x) => x.kind === tab.kind && x.id === tab.id)
      if (idx === -1) return
      for (const x of ordered.slice(idx + 1)) {
        if (tabMeta[tabMetaKey(x)]?.pinned === true) continue
        if (x.kind === 'terminal') get().closeSession(x.id)
        else get().closeFile(x.id)
      }
    },

    closeTabsToLeft: (tab) => {
      const { sessions, files, tabMeta } = get()
      const ordered: ActiveTab[] = [
        ...sessions.map((s) => ({ kind: 'terminal' as const, id: s.id })),
        ...files.map((f) => ({ kind: 'file' as const, id: f.id })),
      ]
      const idx = ordered.findIndex((x) => x.kind === tab.kind && x.id === tab.id)
      if (idx === -1) return
      for (const x of ordered.slice(0, idx)) {
        if (tabMeta[tabMetaKey(x)]?.pinned === true) continue
        if (x.kind === 'terminal') get().closeSession(x.id)
        else get().closeFile(x.id)
      }
    },
  }
}
