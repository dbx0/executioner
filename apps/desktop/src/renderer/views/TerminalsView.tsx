import type { JSX } from 'react'
import { Plus, TerminalSquare, FileText } from 'lucide-react'
import { useApp, tabMetaKey, type ActiveTab } from '../store.js'
import { Terminal } from '../components/terminal/Terminal.js'
import { FileViewer, isMarkdownPath } from '../components/workspace/FileViewer.js'
import { AgentStatusDot } from '../components/brand/AgentStatusDot.js'
import { OnboardingChecklist } from '../components/onboarding/OnboardingChecklist.js'
import { SpawnMenu } from '../components/SpawnMenu.js'
import { TeamPanel, isTeamSession } from '../components/TeamPanel.js'
import { Button } from '../components/ui/button.js'
import { cn } from '../lib/utils.js'
import { EmptySessionActions } from './terminals/EmptySessionActions.js'
import { RunAgentCards } from './terminals/RunAgentCards.js'
import { WorkspaceTab } from './terminals/WorkspaceTab.js'

/** True when this tab is the workspace's active selection. */
function isActiveTab(active: ActiveTab | null, tab: ActiveTab): boolean {
  return active !== null && active.kind === tab.kind && active.id === tab.id
}

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
  const activeTab = useApp((s) => s.activeTab)
  const sessionState = useApp((s) => s.sessionState)
  const tabMeta = useApp((s) => s.tabMeta)
  const closeSession = useApp((s) => s.closeSession)
  const closeFile = useApp((s) => s.closeFile)
  const promoteFileTab = useApp((s) => s.promoteFileTab)
  const setActiveTab = useApp((s) => s.setActiveTab)
  const pulseSession = useApp((s) => s.pulseSession)
  const toggleTabPin = useApp((s) => s.toggleTabPin)
  const setTabColor = useApp((s) => s.setTabColor)
  const closeOtherTabs = useApp((s) => s.closeOtherTabs)
  const closeTabsToRight = useApp((s) => s.closeTabsToRight)
  const closeTabsToLeft = useApp((s) => s.closeTabsToLeft)
  const error = useApp((s) => s.error)

  const empty = sessions.length === 0 && files.length === 0

  // The flat strip order (terminals then files). Derived in the body (not a
  // selector) so the pinned-protection checks stay simple.
  const orderedTabs: ActiveTab[] = [
    ...sessions.map((s) => ({ kind: 'terminal' as const, id: s.id })),
    ...files.map((f) => ({ kind: 'file' as const, id: f.id })),
  ]
  const isPinned = (t: ActiveTab): boolean => tabMeta[tabMetaKey(t)]?.pinned === true
  const tabIndex = (t: ActiveTab): number => orderedTabs.findIndex((x) => x.kind === t.kind && x.id === t.id)
  // A bulk action is only enabled when it would actually close an unpinned tab.
  const hasUnpinnedOthers = (t: ActiveTab): boolean =>
    orderedTabs.some((x) => !(x.kind === t.kind && x.id === t.id) && !isPinned(x))
  const hasUnpinnedToRight = (t: ActiveTab): boolean => orderedTabs.slice(tabIndex(t) + 1).some((x) => !isPinned(x))
  const hasUnpinnedToLeft = (t: ActiveTab): boolean => orderedTabs.slice(0, tabIndex(t)).some((x) => !isPinned(x))

  return (
    <div className="flex h-full flex-col">
      {/* Tab strip: terminals then files. */}
      <div className="flex h-9 shrink-0 items-center border-b border-border pl-1 pr-2">
        <div className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {sessions.map((s) => {
            const tab: ActiveTab = { kind: 'terminal', id: s.id }
            const meta = tabMeta[tabMetaKey(tab)]
            return (
              <WorkspaceTab
                key={`t-${s.id}`}
                tab={tab}
                title={s.title ?? s.label}
                active={isActiveTab(activeTab, tab)}
                statusDot={<AgentStatusDot state={sessionState[s.id] ?? 'idle'} />}
                pinned={meta?.pinned === true}
                color={meta?.color}
                onSelect={() => setActiveTab(tab)}
                onClose={() => closeSession(s.id)}
                onCloseOthers={() => closeOtherTabs(tab)}
                onCloseToRight={() => closeTabsToRight(tab)}
                onCloseToLeft={() => closeTabsToLeft(tab)}
                canCloseOthers={hasUnpinnedOthers(tab)}
                canCloseToRight={hasUnpinnedToRight(tab)}
                canCloseToLeft={hasUnpinnedToLeft(tab)}
                onTogglePin={() => toggleTabPin(tab)}
                onSetColor={(c) => setTabColor(tab, c)}
              />
            )
          })}
          {files.map((f) => {
            const tab: ActiveTab = { kind: 'file', id: f.id }
            const meta = tabMeta[tabMetaKey(tab)]
            return (
              <WorkspaceTab
                key={`f-${f.id}`}
                tab={tab}
                title={f.title ?? f.name}
                active={isActiveTab(activeTab, tab)}
                icon={
                  <FileText
                    className={cn('size-3.5 shrink-0', isMarkdownPath(f.path) ? 'text-muted-foreground' : 'text-muted-foreground')}
                    strokeWidth={1.75}
                  />
                }
                pinned={meta?.pinned === true}
                color={meta?.color}
                onSelect={() => setActiveTab(tab)}
                onClose={() => closeFile(f.id)}
                onCloseOthers={() => closeOtherTabs(tab)}
                onCloseToRight={() => closeTabsToRight(tab)}
                onCloseToLeft={() => closeTabsToLeft(tab)}
                canCloseOthers={hasUnpinnedOthers(tab)}
                canCloseToRight={hasUnpinnedToRight(tab)}
                canCloseToLeft={hasUnpinnedToLeft(tab)}
                onTogglePin={() => toggleTabPin(tab)}
                onSetColor={(c) => setTabColor(tab, c)}
                filePath={f.path}
                preview={f.preview === true}
                dirty={f.dirty === true}
                onPromote={() => promoteFileTab(f.id)}
              />
            )
          })}
        </div>
        <SpawnMenu>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="New session">
            <Plus className="size-4" strokeWidth={1.75} />
          </Button>
        </SpawnMenu>
      </div>

      {error !== null && empty && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="relative min-h-0 flex-1 bg-card">
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
              const shown = activeTab?.kind === 'terminal' && activeTab.id === s.id
              const team = isTeamSession(s.agent)
              return (
                <div key={s.id} className={cn('absolute inset-0 flex-col gap-1.5 p-1.5', shown ? 'flex' : 'hidden')}>
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
                const shown = activeTab?.kind === 'file' && activeTab.id === f.id
                return (
                  <div key={f.id} className={cn('absolute inset-0', shown ? 'block' : 'hidden')}>
                    <FileViewer client={client} file={f} />
                  </div>
                )
              })}
          </>
        )}
      </div>
    </div>
  )
}
