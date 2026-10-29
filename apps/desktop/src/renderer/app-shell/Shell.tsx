import type { JSX } from 'react'
import { useEffect } from 'react'
import { useApp, type ViewId } from '../store.js'
import { eventsUrl } from '../lib/connection.js'
import { emitChange, type ChangeTopic } from '../lib/engine-changes.js'
import { parseEngineEvent } from '../lib/events.js'
import { playNotificationChime, notifyUser } from '../lib/notify.js'
import { TooltipProvider } from '../components/ui/tooltip.js'
import { CommandPalette } from '../components/CommandPalette.js'
import { FloatingNotepad } from '../components/FloatingNotepad.js'
import { OnboardingModal } from '../components/onboarding/OnboardingModal.js'
import { NewEngagementModal } from '../components/modals/NewEngagementModal.js'
import { PageTour } from '../components/tour/PageTour.js'
import { Titlebar } from './Titlebar.js'
import { Sidebar } from './Sidebar.js'
import { RightSidebar } from './RightSidebar.js'
import { EngagementRail } from './EngagementRail.js'
import { StatusBar } from './StatusBar.js'
import { Landing } from './Landing.js'
import { AboutView } from '../views/AboutView.js'
import { ScopeView } from '../views/ScopeView.js'
import { TargetsView } from '../views/TargetsView.js'
import { FindingsView } from '../views/FindingsView.js'
import { WorkflowsView } from '../views/WorkflowsView.js'
import { ToolsView } from '../views/ToolsView.js'
import { TerminalsView } from '../views/TerminalsView.js'
import { SettingsView } from '../views/SettingsView.js'

function NonTerminalView({ view }: { view: ViewId }): JSX.Element | null {
  switch (view) {
    case 'about':
      return <AboutView />
    case 'scope':
      return <ScopeView />
    case 'targets':
      return <TargetsView />
    case 'findings':
      return <FindingsView />
    case 'workflows':
      return <WorkflowsView />
    case 'tools':
      return <ToolsView />
    case 'settings':
      return <SettingsView />
    case 'terminals':
      return null
  }
}

/**
 * The Terminals workbench stays mounted (just hidden) while other sections are
 * open, so xterm instances and their PTY sockets survive section switches
 * instead of blanking on return. Other views mount and unmount normally.
 */
function ActivePage(): JSX.Element {
  const view = useApp((s) => s.activeView)
  return (
    <>
      <div className={view === 'terminals' ? 'h-full' : 'hidden'}>
        <TerminalsView />
      </div>
      {view !== 'terminals' && (
        <div className="h-full">
          <NonTerminalView view={view} />
        </div>
      )}
    </>
  )
}

// ⌘1…⌘6, in the order the sidebar lists them.
const NUMBER_VIEWS: ViewId[] = ['scope', 'targets', 'findings', 'workflows', 'terminals', 'settings']

function useKeybindings(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const s = useApp.getState()
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPalette(!s.paletteOpen)
        return
      }
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault()
        if (e.shiftKey) s.toggleRightSidebar()
        else s.toggleSidebar()
        return
      }
      // ⌘/Ctrl+W closes the active workspace tab (pinned tabs are protected).
      if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        const active = s.activeTab
        if (active !== null) {
          e.preventDefault()
          const pinned = s.tabMeta[`${active.kind}:${active.id}`]?.pinned === true
          if (!pinned) {
            if (active.kind === 'terminal') s.closeSession(active.id)
            else s.closeFile(active.id)
          }
        }
        return
      }
      // ⌘/Ctrl+R renames (Change Title) the active tab — but not while an input or
      // the inline rename field is focused, so it can't hijack typing/reload there.
      if (e.key.toLowerCase() === 'r' && !e.shiftKey) {
        const el = document.activeElement
        const inField =
          el instanceof HTMLElement &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        if (inField) return
        const active = s.activeTab
        if (active !== null) {
          e.preventDefault()
          s.requestTabRename(active)
        }
        return
      }
      const num = Number(e.key)
      if (num >= 1 && num <= NUMBER_VIEWS.length && s.connection !== null) {
        e.preventDefault()
        s.setActiveView(NUMBER_VIEWS[num - 1]!)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Stream the active engine's agent-hook events into the store for live status. */
/** Refresh the machine-wide installed-agent list whenever a connection is up, so
 *  every agent picker only offers agents whose CLI is actually installed. */
function useAgentStatusRefresh(): void {
  const connection = useApp((s) => s.connection)
  const refreshAgents = useApp((s) => s.refreshAgents)
  useEffect(() => {
    if (connection === null) return
    refreshAgents()
  }, [connection, refreshAgents])
}

function useAgentEvents(): void {
  const connection = useApp((s) => s.connection)
  const handleAgentEvent = useApp((s) => s.handleAgentEvent)
  useEffect(() => {
    if (connection === null) return
    const ws = new WebSocket(eventsUrl(connection))
    ws.onmessage = (m) => {
      const e = parseEngineEvent(String(m.data))
      if (e?.type === 'change') {
        emitChange(e.nodeId as ChangeTopic)
        return
      }
      if (e?.type === 'agent') {
        if (e.nodeId === 'SessionStart' || e.nodeId === 'Stop' || e.nodeId === 'SessionEnd') emitChange('sessions')
        let payload: Record<string, unknown> = {}
        try {
          payload = JSON.parse(e.data) as Record<string, unknown>
        } catch {
          /* ignore malformed payloads */
        }
        // The agent's Notification hook means it needs the user (a question, a
        // permission prompt, or it's idle waiting): chime, and raise an OS
        // notification when the window isn't focused.
        if (e.nodeId === 'Notification') {
          playNotificationChime()
          if (!document.hasFocus()) {
            const message = typeof payload.message === 'string' ? payload.message : undefined
            notifyUser('An agent needs your input', message)
          }
        }
        handleAgentEvent(e.executionId, e.nodeId, payload)
      }
    }
    return () => ws.close()
  }, [connection, handleAgentEvent])
}

/** On launch, re-open the engagements that were open last time so the user lands back in their session. */
function useRestoreSession(): void {
  useEffect(() => {
    void useApp.getState().restoreSession()
  }, [])
}

export function Shell(): JSX.Element {
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const hasEngagement = useApp((s) => s.connection !== null)
  const openCount = useApp((s) => s.open.length)
  useRestoreSession()
  useKeybindings()
  useAgentEvents()
  useAgentStatusRefresh()

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background text-foreground">
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          {openCount > 0 && <EngagementRail />}
          {!collapsed && <Sidebar />}
          <main className="min-w-0 flex-1 overflow-hidden bg-background">
            {hasEngagement ? <ActivePage /> : <Landing />}
          </main>
          {hasEngagement && <RightSidebar />}
        </div>
        {hasEngagement && <StatusBar />}
      </div>
      <CommandPalette />
      <FloatingNotepad />
      <OnboardingModal />
      <NewEngagementModal />
      <PageTour />
    </TooltipProvider>
  )
}
