import { createClient } from '../../lib/connection.js'
import { terminalsApi, type TerminalSpec } from '../../api/terminals.js'
import { projectApi } from '../../api/project.js'
import { basename, mirror, patchRecent, rememberRecent } from '../helpers.js'
import {
  loadEditorState,
  loadFiles,
  loadSession,
  loadSessions,
  loadTabMeta,
  saveSession,
  saveSessionRoots,
  saveSessions,
} from '../persistence.js'
import type { ActiveTab, AppState, FileTab, OpenEngagement, Session } from '../types.js'
import type { SliceCtx } from './context.js'

/** Guards against re-running the one-time startup restore (e.g. React StrictMode double-mount). */
let restored = false

/** Opening, creating, switching and restoring engagements. */
export function createEngagementsSlice(ctx: SliceCtx): Pick<AppState, 'restoreSession' | 'openEngagement' | 'openNewEngagement' | 'closeNewEngagement' | 'pickEngagementFolder' | 'createEngagement' | 'openEngagementFolder' | 'updateEngagementMeta' | 'beginScopeRun' | 'openRecent' | 'switchEngagement' | 'closeEngagement'> {
  const { set, get } = ctx

  const activate = (engagement: OpenEngagement): void => {
    const others = get().open.filter((e) => e.root !== engagement.root)
    const open = [...others, engagement]
    set({
      open,
      activeRoot: engagement.root,
      activeView: 'terminals',
      recents: rememberRecent(get().recents, {
        root: engagement.root,
        name: engagement.name,
        // On a create we already hold the chosen badge; passing it means the
        // recent is right immediately rather than only once the metadata
        // refresh lands (and stays right if that request never does).
        ...(engagement.icon !== undefined && engagement.icon !== '' ? { icon: engagement.icon } : {}),
        ...(engagement.photo !== undefined && engagement.photo !== '' ? { photo: engagement.photo } : {}),
      }),
      ...mirror(open, engagement.root),
    })
    saveSession(open, engagement.root)
  }

  /** Establish a real engine connection for a root without touching the store.
   *  Throws when the engine cannot be started: the caller needs the reason, so a
   *  failed restore can say why instead of silently coming up empty. */
  const buildEngagement = async (root: string): Promise<OpenEngagement> => {
    const connection = await window.executioner.openProject({ dir: root, create: false, name: basename(root) })
    // The engagement's real name and badge live in its folder (config.json for
    // the name and emoji, `.executioner/icon.png` for the photo), which only
    // refreshEngagementMeta reads. Seed from the remembered entry so the rail
    // shows the right badge straight away instead of initials over a folder
    // basename; the refresh then confirms or corrects it.
    const remembered = get().recents.find((r) => r.root === connection.projectRoot)
    return {
      root: connection.projectRoot,
      name: remembered?.name ?? basename(connection.projectRoot),
      ...(remembered?.icon !== undefined && remembered.icon !== '' ? { icon: remembered.icon } : {}),
      ...(remembered?.photo !== undefined && remembered.photo !== '' ? { photo: remembered.photo } : {}),
      connection,
      client: createClient(connection),
      sessions: [],
      activeSessionId: null,
      sessionState: {},
      subagents: {},
      files: [],
      activeTab: null,
      tabMeta: {},
      editorDrafts: {},
      diskBaselines: {},
      externalMutation: {},
    }
  }

  /**
   * Recreate an engagement's persisted sessions after its connection is up:
   * claude agents resume their prior conversation (a stale resume id falls back
   * to a fresh launch engine-side), plain shells reopen fresh. Each recreated
   * terminal gets a new engine id; we rewrite the persisted set with the new ids
   * so later hooks (keyed by id) match.
   */
  const restoreEngagementSessions = async (root: string): Promise<void> => {
    const persisted = loadSessions(root)
    // Open file tabs are just paths + titles: restore them straight from storage
    // (the viewer re-reads content lazily) — no engine round-trip needed.
    const restoredFiles: FileTab[] = loadFiles(root).map((pf) => {
      const f: FileTab = { id: pf.id, path: pf.path, name: pf.name }
      if (pf.title !== undefined && pf.title !== '') f.title = pf.title
      return f
    })
    const restoredMeta = loadTabMeta(root)
    // Unsaved buffers are the user's unwritten work — restore them with the
    // tabs. File-tab ids are stable across a restart (toPersistedFile keeps
    // `id`, and the restore above reuses it), so drafts key straight back on.
    const restoredEditor = loadEditorState(root)
    if (
      persisted.length === 0 &&
      restoredFiles.length === 0 &&
      Object.keys(restoredMeta).length === 0 &&
      Object.keys(restoredEditor.drafts).length === 0
    )
      return
    const engagement = get().open.find((e) => e.root === root)
    if (engagement === undefined) return
    const api = terminalsApi(engagement.client)
    const restoredSessions: Session[] = []
    for (const ps of persisted) {
      try {
        const spec: TerminalSpec =
          ps.agent === 'shell'
            ? { kind: 'shell' }
            : ps.resume !== undefined && ps.resume !== ''
              ? { agent: ps.agent, resume: ps.resume }
              : { agent: ps.agent }
        const { id } = await api.create(spec)
        const s: Session = { id, label: ps.label, agent: ps.agent }
        if (ps.title !== undefined && ps.title !== '') s.title = ps.title
        if (ps.resume !== undefined && ps.resume !== '') s.resume = ps.resume
        restoredSessions.push(s)
      } catch {
        /* a session that fails to recreate is dropped rather than blocking the rest */
      }
    }
    const first = restoredSessions[0]
    const firstFile = restoredFiles[0]
    // Prefer a terminal as the opening tab; fall back to a file if that's all there is.
    const activeTab: ActiveTab | null = first
      ? { kind: 'terminal', id: first.id }
      : firstFile
        ? { kind: 'file', id: firstFile.id }
        : null
    set((state) => {
      const open = state.open.map((e) =>
        e.root === root
          ? {
              ...e,
              sessions: restoredSessions,
              // A restored tab carrying a draft must come back dirty, or its
              // tab shows no unsaved marker for work that is still pending.
              files: restoredFiles.map((f) =>
                restoredEditor.drafts[f.id] === undefined ? f : { ...f, dirty: true },
              ),
              activeSessionId: first?.id ?? e.activeSessionId,
              activeTab,
              tabMeta: restoredMeta,
              editorDrafts: restoredEditor.drafts,
              diskBaselines: restoredEditor.baselines,
              // Deliberately not restored: the first disk check on mount
              // re-derives any conflict from the restored baseline, so a
              // persisted mark could only show one that no longer exists.
              externalMutation: {},
            }
          : e,
      )
      return { open, ...mirror(open, state.activeRoot) }
    })
    saveSessions(root, restoredSessions)
  }

  /** Pull the authoritative name + badge from the engagement folder and patch
   *  them onto the open engagement: the name and emoji come from config.json via
   *  the engine, the photo straight off disk. Best-effort; a failure leaves the
   *  seeded fallback in place.
   *
   *  The photo read is what keeps a badge honest — a photo replaced or deleted
   *  outside the app is picked up the next time the engagement is opened, the
   *  same way the emoji is re-read from config every time. */
  const refreshEngagementMeta = async (root: string): Promise<void> => {
    const engagement = get().open.find((e) => e.root === root)
    if (engagement === undefined) return
    const [metaResult, photo] = await Promise.all([
      projectApi(engagement.client).get().then(
        (m) => ({ ok: true as const, meta: m }),
        () => ({ ok: false as const }),
      ),
      // A missing file is a normal answer (no photo), not a failure.
      window.executioner.readEngagementPhoto({ root }).catch(() => null),
    ])
    // The engine may not expose /project (an older engagement): keep the seeded
    // name and emoji, but still apply whatever the folder says about the photo.
    const meta = metaResult.ok ? metaResult.meta : null
    set((state) => {
      const open = state.open.map((e) => {
        if (e.root !== root) return e
        const next: OpenEngagement = { ...e }
        if (meta !== null) {
          next.name = meta.name
          if (meta.icon !== null && meta.icon !== '') next.icon = meta.icon
          else delete next.icon
        }
        if (photo !== null && photo !== '') next.photo = photo
        else delete next.photo
        return next
      })
      return {
        open,
        recents: patchRecent(state.recents, root, {
          // Only what was actually read is authoritative: with the engine
          // unavailable the remembered name and emoji stay put.
          ...(meta !== null ? { name: meta.name, icon: meta.icon } : {}),
          photo,
        }),
        ...mirror(open, state.activeRoot),
      }
    })
  }

  const openInto = async (dir: string, create: boolean): Promise<void> => {
    const name = basename(dir)
    const existing = get().open.find((e) => e.root === dir || e.name === name)
    if (existing !== undefined && !create) {
      set({ activeRoot: existing.root, activeView: 'terminals', ...mirror(get().open, existing.root) })
      saveSession(get().open, existing.root)
      return
    }
    const connection = await window.executioner.openProject({ dir, create, name })
    const already = get().open.find((e) => e.root === connection.projectRoot)
    if (already !== undefined) {
      set({ activeRoot: already.root, activeView: 'terminals', ...mirror(get().open, already.root) })
      saveSession(get().open, already.root)
      return
    }
    // Seed the badge from what we remember about this folder so the rail paints
    // it immediately; the refresh below re-reads the folder and corrects it.
    const remembered = get().recents.find((r) => r.root === connection.projectRoot)
    activate({
      root: connection.projectRoot,
      name,
      ...(remembered?.icon !== undefined && remembered.icon !== '' ? { icon: remembered.icon } : {}),
      ...(remembered?.photo !== undefined && remembered.photo !== '' ? { photo: remembered.photo } : {}),
      connection,
      client: createClient(connection),
      sessions: [],
      activeSessionId: null,
      sessionState: {},
      subagents: {},
      files: [],
      activeTab: null,
      tabMeta: {},
      editorDrafts: {},
      diskBaselines: {},
      externalMutation: {},
    })
    // Opening an engagement by hand has to bring its tabs back exactly as the
    // startup restore does. Without this an engagement opened from the recents
    // list came up with no agents, and the first session created in it then
    // overwrote the persisted set — losing the resume ids for good.
    await restoreEngagementSessions(connection.projectRoot)
    // Every open path ends here, so this is where the engagement's real name and
    // badge get read back out of its folder.
    await refreshEngagementMeta(connection.projectRoot)
  }

  return {
    openEngagement: async (create) => {
      set({ error: null })
      const dir = await window.executioner.pickFolder()
      if (dir === undefined) return
      set({ busy: true })
      try {
        await openInto(dir, create)
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    openNewEngagement: (tab = 'ai') => set({ newEngagementOpen: true, newEngagementTab: tab, error: null }),
    closeNewEngagement: () => set({ newEngagementOpen: false }),
    pickEngagementFolder: () => window.executioner.pickFolder(),

    createEngagement: async (input) => {
      set({ busy: true, error: null })
      try {
        const connection = await window.executioner.openProject({
          dir: input.dir,
          create: true,
          name: input.name,
          ...(input.icon !== undefined && input.icon !== '' ? { icon: input.icon } : {}),
          ...(input.description !== undefined && input.description !== '' ? { description: input.description } : {}),
          ...(input.scope !== undefined && input.scope !== '' ? { scope: input.scope } : {}),
        })
        // The photo is stored only once the folder exists, so the modal can
        // offer it before a folder has even been chosen. What comes back is what
        // landed on disk, which is what every badge then renders.
        const photo =
          input.photo !== undefined && input.photo !== ''
            ? await window.executioner
                .writeEngagementPhoto({ root: connection.projectRoot, dataUrl: input.photo })
                .catch(() => null)
            : null
        const already = get().open.find((e) => e.root === connection.projectRoot)
        if (already === undefined) {
          const engagement: OpenEngagement = {
            root: connection.projectRoot,
            name: input.name,
            connection,
            client: createClient(connection),
            sessions: [],
            activeSessionId: null,
            sessionState: {},
            subagents: {},
            files: [],
            activeTab: null,
            tabMeta: {},
            editorDrafts: {},
            diskBaselines: {},
            externalMutation: {},
          }
          if (input.icon !== undefined && input.icon !== '') engagement.icon = input.icon
          if (photo !== null && photo !== '') engagement.photo = photo
          activate(engagement)
        } else {
          set({ activeRoot: already.root, activeView: 'terminals', ...mirror(get().open, already.root) })
        }
        void refreshEngagementMeta(connection.projectRoot)
        return connection.projectRoot
      } catch (e) {
        set({ error: (e as Error).message })
        return null
      } finally {
        set({ busy: false })
      }
    },

    openEngagementFolder: async (dir) => {
      set({ busy: true, error: null })
      try {
        await openInto(dir, false)
        return get().activeRoot
      } catch (e) {
        set({ error: (e as Error).message })
        return null
      } finally {
        set({ busy: false })
      }
    },

    updateEngagementMeta: async ({ photo, ...patch }) => {
      const { client, activeRoot } = get()
      if (client === null || activeRoot === null) return
      // An engagement shows one badge, so the two are exclusive: choosing a photo
      // clears the emoji, and choosing an emoji deletes the stored photo.
      const nextPatch =
        photo !== undefined && photo !== '' ? { ...patch, icon: '' } : patch
      const meta = await projectApi(client).update(nextPatch)
      let stored: string | null = null
      if (photo !== undefined) {
        if (photo === '') window.executioner.clearEngagementPhoto({ root: activeRoot })
        else
          stored = await window.executioner
            .writeEngagementPhoto({ root: activeRoot, dataUrl: photo })
            .catch(() => null)
      }
      set((state) => {
        const open = state.open.map((e) => {
          if (e.root !== activeRoot) return e
          const next: OpenEngagement = { ...e, name: meta.name }
          if (meta.icon !== null && meta.icon !== '') next.icon = meta.icon
          else delete next.icon
          if (photo !== undefined) {
            if (stored !== null && stored !== '') next.photo = stored
            else delete next.photo
          }
          return next
        })
        return {
          open,
          recents: patchRecent(state.recents, activeRoot, {
            name: meta.name,
            icon: meta.icon,
            ...(photo !== undefined ? { photo: stored } : {}),
          }),
          ...mirror(open, state.activeRoot),
        }
      })
    },

    beginScopeRun: (runId) =>
      set((state) => ({ scopeRuns: { ...state.scopeRuns, [runId]: { bubbles: [], done: false } } })),

    openRecent: async (root) => {
      set({ busy: true, error: null })
      try {
        await openInto(root, false)
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    restoreSession: async () => {
      if (restored) return
      restored = true
      if (get().open.length > 0) return
      const { roots, activeRoot } = loadSession()
      if (roots.length === 0) return
      set({ busy: true })
      try {
        const built = await Promise.allSettled(roots.map(buildEngagement))
        const engagements: OpenEngagement[] = []
        const failures: string[] = []
        built.forEach((r, i) => {
          if (r.status === 'rejected') failures.push(`${basename(roots[i]!)}: ${(r.reason as Error).message}`)
          else if (!engagements.some((x) => x.root === r.value.root)) engagements.push(r.value)
        })
        if (engagements.length === 0) {
          // Every engine failed to start. That is usually transient, so leave the
          // remembered roots alone — erasing them here cost the user their whole
          // session for good, and the next launch would come up empty even once
          // the engine was healthy again. Say what went wrong instead.
          set({ error: failures[0] ?? 'could not reopen the last engagements' })
          return
        }
        const nextActive = engagements.some((e) => e.root === activeRoot) && activeRoot !== null ? activeRoot : engagements[0]!.root
        const recents = engagements.reduce((acc, e) => rememberRecent(acc, { root: e.root, name: e.name }), get().recents)
        set({ open: engagements, activeRoot: nextActive, activeView: 'terminals', recents, ...mirror(engagements, nextActive) })
        if (failures.length > 0) set({ error: failures[0]! })
        // A root whose engine failed stays in the remembered set: it is still one
        // of the user's open engagements, and dropping it here would make one bad
        // start permanent. Successful ones are stored under the root the engine
        // reports, which is the canonical path.
        const kept = built.map((r, i) => (r.status === 'rejected' ? roots[i]! : r.value.root))
        saveSessionRoots([...new Set(kept)], nextActive)
        // Connections are live now: bring back each engagement's open agent tabs,
        // resuming claude conversations so the chat comes back (not blank), and
        // pull each engagement's real name + icon from its config.json — without
        // this a restored engagement keeps the folder basename and loses the
        // emoji the user chose, for the whole session.
        await Promise.all([
          ...engagements.map((e) => restoreEngagementSessions(e.root)),
          ...engagements.map((e) => refreshEngagementMeta(e.root)),
        ])
      } finally {
        set({ busy: false })
      }
    },

    switchEngagement: (root) => {
      set({ activeRoot: root, ...mirror(get().open, root) })
      saveSession(get().open, root)
    },

    closeEngagement: (root) => {
      const target = root ?? get().activeRoot
      // Each open engagement holds its own engine; closing the tab is what
      // releases it. Without this the child would outlive the tab that used it.
      if (target !== null) window.executioner.closeProject({ dir: target })
      const open = get().open.filter((e) => e.root !== target)
      const activeRoot = get().activeRoot === target ? (open[open.length - 1]?.root ?? null) : get().activeRoot
      set({ open, activeRoot, ...mirror(open, activeRoot) })
      saveSession(open, activeRoot)
    },
  }
}
