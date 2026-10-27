import { create } from 'zustand'
import { applyTheme } from '../lib/themes.js'
import { mirror } from './helpers.js'
import {
  loadDefaultAgent,
  loadEditorAutoSave,
  loadDefaultExecution,
  loadOnboarded,
  loadToursSeen,
  loadRecents,
  loadRightCollapsed,
  loadRightTab,
  loadTheme,
  saveEditorState,
  saveFiles,
  saveSessions,
  saveTabMeta,
} from './persistence.js'
import type { SliceCtx } from './slices/context.js'
import { createAgentsSlice } from './slices/agents.js'
import { createEditorSlice } from './slices/editor.js'
import { createEngagementsSlice } from './slices/engagements.js'
import { createSessionsSlice } from './slices/sessions.js'
import { createTabsSlice } from './slices/tabs.js'
import { createUiSlice } from './slices/ui.js'
import type { AppState, OpenEngagement } from './types.js'

export const useApp = create<AppState>((set, get) => {
  const initialTheme = loadTheme()
  applyTheme(initialTheme)

  /** Mutate the active engagement in place and re-mirror. */
  const patchActive = (fn: (e: OpenEngagement) => OpenEngagement): void => {
    const { open, activeRoot } = get()
    const next = open.map((e) => (e.root === activeRoot ? fn(e) : e))
    set({ open: next, ...mirror(next, activeRoot) })
  }

  /** Persist one engagement's open sessions so they can be restored on restart. */
  const persistSessions = (root: string | null): void => {
    if (root === null) return
    const e = get().open.find((x) => x.root === root)
    if (e !== undefined) saveSessions(root, e.sessions)
  }

  /** Persist one engagement's open file tabs so they (and their titles) come back. */
  const persistFiles = (root: string | null): void => {
    if (root === null) return
    const e = get().open.find((x) => x.root === root)
    if (e !== undefined) saveFiles(root, e.files)
  }

  /** Persist one engagement's per-tab pin/color state. */
  const persistTabMeta = (root: string | null): void => {
    if (root === null) return
    const e = get().open.find((x) => x.root === root)
    if (e !== undefined) saveTabMeta(root, e.tabMeta)
  }

  /** Persist one engagement's unsaved buffers and disk baselines. */
  const persistEditorState = (root: string | null): void => {
    if (root === null) return
    const e = get().open.find((x) => x.root === root)
    if (e !== undefined) saveEditorState(root, e.editorDrafts, e.diskBaselines)
  }

  const ctx: SliceCtx = {
    set,
    get,
    patchActive,
    persistSessions,
    persistFiles,
    persistTabMeta,
    persistEditorState,
  }

  return {
    theme: initialTheme,
    activeView: 'terminals',
    sidebarCollapsed: false,
    rightSidebarCollapsed: loadRightCollapsed(),
    activeRightTab: loadRightTab(),
    defaultAgent: loadDefaultAgent(),
    defaultExecution: loadDefaultExecution(),
    onboardingOpen: !loadOnboarded(),
    toursSeen: loadToursSeen(),
    newEngagementOpen: false,
    newEngagementTab: 'ai',
    scopeRuns: {},
    paletteOpen: false,
    pendingTargetId: null,
    hubTab: 'workflows',
    pendingExecutionId: null,
    pendingFindingId: null,
    pendingToolTargetId: null,
    settingsSection: null,

    open: [],
    activeRoot: null,

    connection: null,
    client: null,
    engagementName: null,
    engagementIcon: null,
    engagementPhoto: null,
    sessions: [],
    activeSessionId: null,
    sessionState: {},
    subagents: {},
    files: [],
    activeTab: null,
    tabMeta: {},
    editorAutoSave: loadEditorAutoSave(),
    editorDrafts: {},
    diskBaselines: {},
    externalMutation: {},
    renameRequest: null,

    recents: loadRecents(),
    busy: false,
    error: null,

    installedAgents: null,

    ...createAgentsSlice(ctx),
    ...createUiSlice(ctx),
    ...createEditorSlice(ctx),
    ...createEngagementsSlice(ctx),
    ...createSessionsSlice(ctx),
    ...createTabsSlice(ctx),
  }
})
