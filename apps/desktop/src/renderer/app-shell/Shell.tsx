import type { CSSProperties, JSX } from 'react'
import { useEffect } from 'react'
import { useApp, type ViewId } from '../store.js'
import { cn } from '../lib/utils.js'
import { eventsUrl } from '../lib/connection.js'
import { emitChange, type ChangeTopic } from '../lib/engine-changes.js'
import { parseEngineEvent } from '../lib/events.js'
import { playNotificationChime, notifyUser } from '../lib/notify.js'
import { Toaster } from 'sonner'
import { TooltipProvider } from '../components/ui/tooltip.js'
import { CommandPalette } from '../components/CommandPalette.js'
import { FloatingNotepad } from '../components/FloatingNotepad.js'
import { OnboardingModal } from '../components/onboarding/OnboardingModal.js'
import { NewEngagementModal } from '../components/modals/NewEngagementModal.js'
import { PageTour } from '../components/tour/PageTour.js'
import { Sidebar } from './Sidebar.js'
import { RightSidebar } from './RightSidebar.js'
import { SidebarToggle } from './SidebarToggle.js'
import { WindowControls } from './WindowControls.js'
import { isDarwin } from './platform.js'
import { Landing } from './Landing.js'
import { AboutView } from '../views/AboutView.js'
import { ScopeView } from '../views/ScopeView.js'
import { TargetsView } from '../views/TargetsView.js'
import { FindingsView } from '../views/FindingsView.js'
import { WorkflowsView } from '../views/WorkflowsView.js'
import { ToolsView } from '../views/ToolsView.js'
import { useBrowserOcclusion } from '../lib/browser-occlusion.js'
import { useBrowserEvents, useBrowserPageTracking } from '../lib/browser-events.js'
import { ATTENTION_TOASTER } from '../lib/toast.js'
import { TerminalsView } from '../views/TerminalsView.js'
import { ActionsView } from '../views/ActionsView.js'
import { SettingsView } from '../views/SettingsView.js'
import { isMacPlatform, workspaceShortcut } from '../lib/shortcuts.js'
import { errorFields, rlog } from '../lib/log.js'

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
    case 'actions':
      return <ActionsView />
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

export function useKeybindings(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const s = useApp.getState()
      const shortcut = workspaceShortcut(e, isMacPlatform())
      // The workbench stays mounted while hidden, so these only act while it is the view on screen.
      if (shortcut !== null) {
        if (s.activeView !== 'terminals') return
        const layout = s.layouts.find((l) => l.id === s.activeLayoutId)
        if (layout === undefined) return
        e.preventDefault()
        if (shortcut.kind === 'split') s.splitPane(layout.focusedLeafId, shortcut.dir)
        else s.moveFocus(shortcut.dir)
        return
      }
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
      // ⌘/Ctrl+W closes the focused pane (a pinned tab is protected).
      if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        const layout = s.layouts.find((l) => l.id === s.activeLayoutId)
        if (layout !== undefined) {
          e.preventDefault()
          if (s.tabMeta[layout.id]?.pinned !== true) s.closePane(layout.focusedLeafId)
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
  const syncBrowsers = useApp((s) => s.syncBrowsers)
  // Reconcile on activation whatever the events missed: a restart, an engine that came back.
  useEffect(() => {
    if (connection !== null) void syncBrowsers()
  }, [connection, syncBrowsers])
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

/** On launch, re-open the engagements that were open last time so the user
 *  lands back in their session. The startup splash follows the restore and the
 *  app window appears once it is done. */
function useRestoreSession(): void {
  useEffect(() => {
    // Absent in tests and older preloads.
    const startup = (window.executioner as Partial<Window['executioner']> | undefined)?.startup
    void useApp
      .getState()
      .restoreSession((fraction) => startup?.progress(fraction))
      .catch((e: unknown) => rlog.error('engagements', 'Could not restore the last session', errorFields(e)))
      .finally(() => startup?.ready())
  }, [])
}

/**
 * What the page gives up at its top-left corner while the sidebar is hidden:
 * the floating reopen button and, on macOS, the traffic lights (window x 22 to
 * 74), which then float over the page. `toolbar` pushes the page toolbar's
 * content clear of both, so nothing interactive sits under them. It reaches the
 * shared PageToolbar (`header.app-drag`) from here because the toolbar has no
 * inset of its own.
 */
const COLLAPSED_INSET = {
  darwin: { button: 'left-[82px] top-[15px]', toolbar: '[&_header.app-drag]:pl-[120px]' },
  other: { button: 'left-panel top-[11px]', toolbar: '[&_header.app-drag]:pl-11' },
} as const

export function Shell(): JSX.Element {
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const hasEngagement = useApp((s) => s.connection !== null)
  useRestoreSession()
  useKeybindings()
  useAgentEvents()
  useBrowserEvents()
  useBrowserPageTracking()
  useAgentStatusRefresh()
  useBrowserOcclusion()
  const inset = isDarwin() ? COLLAPSED_INSET.darwin : COLLAPSED_INSET.other

  return (
    <TooltipProvider delayDuration={300}>
      {/* No title bar and no status strip: the sidebar header and each page's
          toolbar drag the window, and the sidebar footer carries the status. */}
      <div className="flex h-dvh w-dvw overflow-hidden bg-background text-foreground">
        {!collapsed && <Sidebar />}
        <main className={cn('relative min-w-0 flex-1 overflow-hidden', collapsed && inset.toolbar)}>
          {hasEngagement ? <ActivePage /> : <Landing />}
          {/* After the page in the DOM on purpose: Electron applies drag regions in
              document order, so a no-drag button placed before the page toolbar is
              swallowed by the toolbar's drag region and cannot be clicked. */}
          {collapsed && <SidebarToggle floating className={cn('absolute z-20', inset.button)} />}
        </main>
        {hasEngagement ? (
          <RightSidebar />
        ) : (
          // No tool capsule without an engagement, but Windows and Linux still need their controls.
          !isDarwin() && (
            <div className="flex w-14 shrink-0 justify-center pt-[10px]">
              <WindowControls />
            </div>
          )
        )}
      </div>
      <CommandPalette />
      <FloatingNotepad />
      <OnboardingModal />
      <NewEngagementModal />
      <PageTour />
      <Toaster
        position="bottom-center"
        theme="dark"
        toastOptions={{
          classNames: {
            toast: 'rounded-panel border-glass-border bg-popover text-popover-foreground text-[13px] shadow-floating',
          },
        }}
      />
      {/* Asks for the operator, as a notch hanging from the top edge of the window (there is no
          title bar any more, so no offset). It is 34px tall and centered, so it only ever covers the
          middle of a page toolbar's 52px drag row, never a panel below it. */}
      <Toaster
        id={ATTENTION_TOASTER}
        position="top-center"
        theme="dark"
        offset={0}
        style={{ '--width': '560px' } as CSSProperties}
        visibleToasts={1}
        className="attention-toaster"
      />
    </TooltipProvider>
  )
}
