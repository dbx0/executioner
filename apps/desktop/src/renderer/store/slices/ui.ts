import { applyTheme } from '../../lib/themes.js'
import {
  saveDefaultAgent,
  saveEditorAutoSave,
  saveDefaultExecution,
  saveOnboarded,
  saveToursSeen,
  saveRightCollapsed,
  saveRightTab,
  saveTheme,
} from '../persistence.js'
import type { AppState } from '../types.js'
import type { SliceCtx } from './context.js'

/** Chrome-level state: theme, onboarding defaults, views, sidebars, palette, hub. */
export function createUiSlice(ctx: SliceCtx): Pick<AppState, 'setEditorAutoSave' | 'setTheme' | 'toggleTheme' | 'setDefaultAgent' | 'setDefaultExecution' | 'openOnboarding' | 'completeOnboarding' | 'markTourSeen' | 'resetTours' | 'setActiveView' | 'setSettingsSection' | 'openSettings' | 'toggleSidebar' | 'toggleRightSidebar' | 'setRightTab' | 'setPalette' | 'setPendingTargetId' | 'setHubTab' | 'openHub' | 'openExecution' | 'setPendingExecutionId' | 'openFinding' | 'setPendingFindingId' | 'openTools' | 'setPendingToolTargetId'> {
  const { set, get } = ctx

  return {
    setEditorAutoSave: (enabled) => {
      saveEditorAutoSave(enabled)
      set({ editorAutoSave: enabled })
    },
    setTheme: (t) => {
      applyTheme(t)
      saveTheme(t)
      set({ theme: t })
    },
    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    setDefaultAgent: (id) => {
      saveDefaultAgent(id)
      set({ defaultAgent: id })
    },
    setDefaultExecution: (m) => {
      saveDefaultExecution(m)
      set({ defaultExecution: m })
    },
    openOnboarding: () => set({ onboardingOpen: true }),
    completeOnboarding: () => {
      saveOnboarded()
      set({ onboardingOpen: false })
    },
    markTourSeen: (id) => {
      const seen = get().toursSeen
      if (seen.includes(id)) return
      const next = [...seen, id]
      saveToursSeen(next)
      set({ toursSeen: next })
    },
    resetTours: () => {
      saveToursSeen([])
      set({ toursSeen: [] })
    },
    setActiveView: (v) => set({ activeView: v }),
    setSettingsSection: (id) => set({ settingsSection: id }),
    openSettings: (section) =>
      set(section === undefined ? { activeView: 'settings' } : { activeView: 'settings', settingsSection: section }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    toggleRightSidebar: () =>
      set((s) => {
        const next = !s.rightSidebarCollapsed
        saveRightCollapsed(next)
        return { rightSidebarCollapsed: next }
      }),
    setRightTab: (t) => {
      saveRightTab(t)
      set({ activeRightTab: t, rightSidebarCollapsed: false })
    },
    setPalette: (open) => set({ paletteOpen: open }),
    setPendingTargetId: (id) => set({ pendingTargetId: id }),
    setHubTab: (t) => set({ hubTab: t }),
    openHub: (t) => set({ activeView: 'workflows', hubTab: t }),
    openExecution: (id) => set({ activeView: 'workflows', hubTab: 'workflows', pendingExecutionId: id }),
    setPendingExecutionId: (id) => set({ pendingExecutionId: id }),
    openFinding: (id) => set({ activeView: 'findings', pendingFindingId: id }),
    setPendingFindingId: (id) => set({ pendingFindingId: id }),
    openTools: (targetId) => set({ activeView: 'tools', pendingToolTargetId: targetId }),
    setPendingToolTargetId: (id) => set({ pendingToolTargetId: id }),
  }
}
