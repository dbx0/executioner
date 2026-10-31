import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Plus, TerminalSquare, FileText, Globe, SquareDashed } from 'lucide-react'
import { useApp, type ActiveTab } from '../store.js'
import { Terminal } from '../components/terminal/Terminal.js'
import { FileViewer, isMarkdownPath } from '../components/workspace/FileViewer.js'
import { AgentStatusDot } from '../components/brand/AgentStatusDot.js'
import { OnboardingChecklist } from '../components/onboarding/OnboardingChecklist.js'
import { SpawnMenu } from '../components/SpawnMenu.js'
import { TeamPanel, isTeamSession } from '../components/TeamPanel.js'
import { Button } from '../components/ui/button.js'
import { keepsNativeMenu } from '../lib/native-context-menu.js'
import { itemKey, leaves, rects, type Rect } from '../lib/pane-tree.js'
import { cn } from '../lib/utils.js'
import { bulkCloseConfirmation, bulkCloseTargets, closeConfirmation, type BulkClose } from '../store/slices/layouts.js'
import { BrowserHandoffItems, BrowserPane } from './terminals/BrowserPane.js'
import { EmptySessionActions } from './terminals/EmptySessionActions.js'
import { PaneMenu, PaneOverlay } from './terminals/PaneOverlay.js'
import { RunAgentCards } from './terminals/RunAgentCards.js'
import { WorkspaceTab } from './terminals/WorkspaceTab.js'

/**
 * The unified workspace: a single tab strip holding terminal sessions AND opened
 * files, over the active tab's content. Terminals stay mounted (hidden) across
 * tab switches so xterm and its PTY survive; files likewise stay mounted so their
 * content isn't refetched. Markdown files render formatted; other text as code.
 */
export function TerminalsView(): JSX.Element {
  const connection = useApp((s) => s.connection)!
  const client = useApp((s) => s.client)
  const sessions = useApp((s) => s.sessions)
  const files = useApp((s) => s.files)
  const browsers = useApp((s) => s.browsers)
  const browserActivity = useApp((s) => s.browserActivity)
  const activeRoot = useApp((s) => s.activeRoot)
  const layouts = useApp((s) => s.layouts)
  const activeLayoutId = useApp((s) => s.activeLayoutId)
  const activeView = useApp((s) => s.activeView)
  const sessionState = useApp((s) => s.sessionState)
  const tabMeta = useApp((s) => s.tabMeta)
  const closeSession = useApp((s) => s.closeSession)
  const splitPane = useApp((s) => s.splitPane)
  const movePaneToNewTab = useApp((s) => s.movePaneToNewTab)
  const closeLayout = useApp((s) => s.closeLayout)
  const closePane = useApp((s) => s.closePane)
  const focusPane = useApp((s) => s.focusPane)
  const promoteFileTab = useApp((s) => s.promoteFileTab)
  const pulseSession = useApp((s) => s.pulseSession)
  const toggleTabPin = useApp((s) => s.toggleTabPin)
  const setTabColor = useApp((s) => s.setTabColor)
  const closeOtherTabs = useApp((s) => s.closeOtherTabs)
  const closeTabsToRight = useApp((s) => s.closeTabsToRight)
  const closeTabsToLeft = useApp((s) => s.closeTabsToLeft)
  const error = useApp((s) => s.error)

  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; leafId: string } | null>(null)

  const empty = sessions.length === 0 && files.length === 0 && browsers.length === 0
  const hostRef = useRef<HTMLDivElement>(null)

  const activeLayout = layouts.find((l) => l.id === activeLayoutId)
  const focusedPane = activeLayout === undefined ? undefined : leaves(activeLayout.root).find((p) => p.id === activeLayout.focusedLeafId)
  const focusedLeafId = focusedPane?.id
  const focusedItem = focusedPane?.item == null ? '' : itemKey(focusedPane.item)

  // Keyboard input goes to the focused pane: when focus changes (shortcut, picker fill, tab switch)
  // move DOM focus into its body. Only from the pane host or from nothing, so a sidebar input, the
  // palette or a dialog keeps focus, and never away from the pane the user just clicked into.
  useEffect(() => {
    const host = hostRef.current
    if (activeView !== 'terminals' || host === null || focusedLeafId === undefined) return
    const at = document.activeElement
    if (at !== null && at !== document.body && !host.contains(at)) return
    const pane = host.querySelector<HTMLElement>(`[data-pane-leaf="${focusedLeafId}"]`)
    if (pane === null || (at !== null && pane.contains(at))) return
    const target =
      pane.querySelector<HTMLElement>('.xterm-helper-textarea, .monaco-editor textarea') ??
      pane.querySelector<HTMLElement>('textarea, input')
    target?.focus()
  }, [activeView, activeLayoutId, focusedLeafId, focusedItem])
  // Where each item sits in the active layout. Items outside it stay mounted but hidden.
  const placements = new Map<string, { leafId: string; rect: Rect }>()
  if (activeLayout !== undefined) {
    const all = rects(activeLayout.root)
    for (const p of leaves(activeLayout.root)) {
      const rect = all.get(p.id)
      if (p.item !== null && rect !== undefined) placements.set(itemKey(p.item), { leafId: p.id, rect })
    }
  }
  const split = activeLayout !== undefined && leaves(activeLayout.root).length >= 2
  const paneProps = (key: string): { style: CSSProperties | undefined; focus: Record<string, ((e: ReactMouseEvent) => void) | string> } => {
    const at = placements.get(key)
    if (at === undefined) return { style: undefined, focus: {} }
    // Terminals and editors keep their own right-click menu; the pane menu covers the rest of the pane.
    const menu = (e: ReactMouseEvent): void => {
      if (keepsNativeMenu(e.target)) return
      e.preventDefault()
      setPaneMenu({ x: e.clientX, y: e.clientY, leafId: at.leafId })
    }
    const focus = (): void => {
      if (activeLayout !== undefined && activeLayout.focusedLeafId !== at.leafId) focusPane(activeLayout.id, at.leafId)
    }
    // A 1px seam between panes: inset 0.5px only on edges shared with another pane.
    const EPS = 1e-6
    const inL = split && at.rect.x > EPS ? 0.5 : 0
    const inR = split && at.rect.x + at.rect.w < 1 - EPS ? 0.5 : 0
    const inT = split && at.rect.y > EPS ? 0.5 : 0
    const inB = split && at.rect.y + at.rect.h < 1 - EPS ? 0.5 : 0
    const edge = (start: number, size: number, a: number, b: number): { start: string; size: string } => ({
      start: a === 0 ? `${start * 100}%` : `calc(${start * 100}% + ${a}px)`,
      size: a + b === 0 ? `${size * 100}%` : `calc(${size * 100}% - ${a + b}px)`,
    })
    const h = edge(at.rect.x, at.rect.w, inL, inR)
    const v = edge(at.rect.y, at.rect.h, inT, inB)
    return {
      style: { left: h.start, top: v.start, width: h.size, height: v.size },
      focus: { 'data-pane-leaf': at.leafId, onMouseDownCapture: focus, onFocusCapture: focus, onContextMenu: menu },
    }
  }

  // The strip: one tab per layout, standing for the layout's focused item (else its first).
  // A layout of only empty panes has no item: it gets a placeholder tab so it can be selected and closed.
  const strip = layouts.map((layout) => {
    const panes = leaves(layout.root)
    const item = (panes.find((p) => p.id === layout.focusedLeafId)?.item ?? panes.find((p) => p.item !== null)?.item) ?? null
    const tab: ActiveTab | null = item === null ? null : { kind: item.kind === 'file' ? 'file' : item.kind === 'browser' ? 'browser' : 'terminal', id: item.id }
    return { layout, tab, split: panes.length >= 2 }
  })
  const isPinned = (layoutId: string): boolean => tabMeta[layoutId]?.pinned === true
  const bulkQuestion = (layoutId: string, which: BulkClose): string | undefined =>
    bulkCloseConfirmation(bulkCloseTargets(layouts, tabMeta, layoutId, which), sessions, sessionState) ?? undefined
  const tabIndex = (layoutId: string): number => strip.findIndex((x) => x.layout.id === layoutId)
  // A bulk action is only enabled when it would actually close an unpinned tab.
  const hasUnpinnedOthers = (layoutId: string): boolean =>
    strip.some((x) => x.layout.id !== layoutId && !isPinned(x.layout.id))
  const hasUnpinnedToRight = (layoutId: string): boolean =>
    strip.slice(tabIndex(layoutId) + 1).some((x) => !isPinned(x.layout.id))
  const hasUnpinnedToLeft = (layoutId: string): boolean =>
    strip.slice(0, tabIndex(layoutId)).some((x) => !isPinned(x.layout.id))

  return (
    <div className="flex h-full flex-col">
      {/* Tab strip: terminals then files. */}
      <div className="flex h-9 shrink-0 items-center border-b border-border pl-1 pr-2">
        <div className="scrollbar-none flex min-w-0 items-stretch overflow-x-auto">
          {strip.map(({ layout, tab: itemTab, split: isSplit }) => {
            const meta = tabMeta[layout.id]
            // The empty-only placeholder has no item; its handlers are never reached (bare menu).
            const tab: ActiveTab = itemTab ?? { kind: 'terminal', id: layout.id }
            const common = {
              tab,
              bare: itemTab === null,
              active: layout.id === activeLayoutId,
              pinned: meta?.pinned === true,
              color: meta?.color,
              split: isSplit,
              onSelect: () => focusPane(layout.id, layout.focusedLeafId),
              // Splitting and breaking out act on the active layout, so select the tab first.
              onSplit: (dir: 'row' | 'col') => {
                focusPane(layout.id, layout.focusedLeafId)
                splitPane(layout.focusedLeafId, dir)
              },
              onMovePaneOut: isSplit
                ? () => {
                    focusPane(layout.id, layout.focusedLeafId)
                    movePaneToNewTab(layout.focusedLeafId)
                  }
                : undefined,
              // On a split tab the X closes the pane the tab is showing, as Ctrl+W does; the
              // menu's "Close all panes" closes the rest.
              onClose: isSplit
                ? () => {
                    focusPane(layout.id, layout.focusedLeafId)
                    closePane(layout.focusedLeafId)
                  }
                : () => closeLayout(layout.id),
              onCloseAll: isSplit ? () => closeLayout(layout.id) : undefined,
              confirmCloseAll: closeConfirmation(layout, sessions, sessionState) ?? undefined,
              confirmBulk: {
                others: bulkQuestion(layout.id, 'others'),
                right: bulkQuestion(layout.id, 'right'),
                left: bulkQuestion(layout.id, 'left'),
              },
              onCloseOthers: () => closeOtherTabs(tab),
              onCloseToRight: () => closeTabsToRight(tab),
              onCloseToLeft: () => closeTabsToLeft(tab),
              canCloseOthers: hasUnpinnedOthers(layout.id),
              canCloseToRight: hasUnpinnedToRight(layout.id),
              canCloseToLeft: hasUnpinnedToLeft(layout.id),
              onTogglePin: () => toggleTabPin(tab),
              onSetColor: (c: string | undefined) => setTabColor(tab, c),
            }
            if (itemTab === null) {
              return (
                <WorkspaceTab
                  key={`l-${layout.id}`}
                  {...common}
                  title="Empty pane"
                  icon={<SquareDashed className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />}
                />
              )
            }
            if (tab.kind === 'terminal') {
              const s = sessions.find((x) => x.id === tab.id)
              if (s === undefined) return null
              return (
                <WorkspaceTab
                  key={`l-${layout.id}`}
                  {...common}
                  title={s.title ?? s.label}
                  statusDot={<AgentStatusDot state={sessionState[s.id] ?? 'idle'} />}
                />
              )
            }
            if (tab.kind === 'browser') {
              const b = browsers.find((x) => x.id === tab.id)
              if (b === undefined) return null
              return (
                <WorkspaceTab
                  key={`l-${layout.id}`}
                  {...common}
                  title={b.title === '' ? 'New tab' : b.title}
                  icon={<Globe className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />}
                  statusDot={
                    browserActivity[b.id] === true ? (
                      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground" role="img" aria-label="Agent active" />
                    ) : undefined
                  }
                  menuExtra={isSplit ? undefined : (close) => <BrowserHandoffItems id={b.id} close={close} />}
                />
              )
            }
            const f = files.find((x) => x.id === tab.id)
            if (f === undefined) return null
            return (
              <WorkspaceTab
                key={`l-${layout.id}`}
                {...common}
                title={f.title ?? f.name}
                icon={
                  <FileText
                    className={cn('size-3.5 shrink-0', isMarkdownPath(f.path) ? 'text-muted-foreground' : 'text-muted-foreground')}
                    strokeWidth={1.75}
                  />
                }
                filePath={f.path}
                preview={f.preview === true}
                dirty={f.dirty === true}
                onPromote={() => promoteFileTab(f.id)}
              />
            )
          })}
        </div>
        <SpawnMenu>
          <Button variant="ghost" size="icon-sm" className="ml-1 shrink-0" aria-label="New session">
            <Plus className="size-4" strokeWidth={1.75} />
          </Button>
        </SpawnMenu>
      </div>

      {error !== null && empty && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div ref={hostRef} className="relative min-h-0 flex-1 bg-card">
        {empty ? (
          <div className="flex h-full flex-col">
            <OnboardingChecklist />
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <TerminalSquare className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                Open a shell or an agent, or pick a file from the explorer, to work inside this engagement.
              </p>
              <EmptySessionActions />
              <RunAgentCards />
            </div>
          </div>
        ) : (
          <>
            {sessions.map((s) => {
              const pane = paneProps(itemKey({ kind: 'terminal', id: s.id }))
              const shown = pane.style !== undefined
              const team = isTeamSession(s.agent)
              return (
                <div
                  key={s.id}
                  className={cn('absolute flex-col gap-1.5 p-1.5', shown ? 'flex' : 'hidden')}
                  style={pane.style}
                  {...pane.focus}
                >
                  {team && <TeamPanel sessionId={s.id} agent={s.agent} />}
                  <div className="relative min-h-0 flex-1">
                    <Terminal
                      connection={connection}
                      sessionId={s.id}
                      // Shells infer activity from output; agents report real status via hooks.
                      onActivity={s.agent === 'shell' ? () => pulseSession(s.id) : undefined}
                      onExit={() => closeSession(s.id)}
                      // Agent TUIs take a multi-line prompt; a shell's Shift+Enter
                      // stays an ordinary Enter.
                      multilineShiftEnter={s.agent !== 'shell'}
                    />
                  </div>
                </div>
              )
            })}
            {client !== null &&
              files.map((f) => {
                const pane = paneProps(itemKey({ kind: 'file', id: f.id }))
                const shown = pane.style !== undefined
                return (
                  <div key={f.id} className={cn('absolute', shown ? 'block' : 'hidden')} style={pane.style} {...pane.focus}>
                    <FileViewer client={client} file={f} />
                  </div>
                )
              })}
            {activeRoot !== null &&
              browsers.map((b) => {
                const pane = paneProps(itemKey({ kind: 'browser', id: b.id }))
                const shown = pane.style !== undefined
                const leafId = placements.get(itemKey({ kind: 'browser', id: b.id }))?.leafId
                return (
                  <div key={b.id} className={cn('absolute', shown ? 'block' : 'hidden')} style={pane.style} {...pane.focus}>
                    <BrowserPane
                      root={activeRoot}
                      browser={b}
                      active={shown && activeLayout?.focusedLeafId === leafId}
                      visible={shown && activeView === 'terminals'}
                    />
                  </div>
                )
              })}
            {activeLayout !== undefined && <PaneOverlay layout={activeLayout} />}
            {paneMenu !== null && <PaneMenu {...paneMenu} onClose={() => setPaneMenu(null)} />}
          </>
        )}
      </div>
    </div>
  )
}
