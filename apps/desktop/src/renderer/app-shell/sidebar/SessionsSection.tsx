import type { JSX } from 'react'
import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight, TerminalSquare, Plus } from 'lucide-react'
import { useApp, type Session } from '../../store.js'
import { buildSubagentTree, anySubtreeWorking } from '../../lib/subagent-tree.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../../components/ui/button.js'
import { AgentStatusDot } from '../../components/brand/AgentStatusDot.js'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { SpawnMenu } from '../../components/SpawnMenu.js'
import { SectionLabel } from './SectionLabel.js'
import { SidebarRow, sidebarRowClass } from './SidebarRow.js'
import { SubagentChildren } from './SubagentRows.js'

function SessionRow({ id, label, icon: Icon }: { id: string; label: string; icon: LucideIcon }): JSX.Element {
  const isActive = useApp((s) => s.activeSessionId === id)
  const state = useApp((s) => s.sessionState[id] ?? 'idle')
  const setActiveSession = useApp((s) => s.setActiveSession)
  const setActiveView = useApp((s) => s.setActiveView)
  return (
    <SidebarRow
      active={isActive}
      className="h-[30px]"
      onClick={() => {
        setActiveSession(id)
        setActiveView('terminals')
      }}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
      {state === 'working' && <AgentStatusDot state="working" className="ml-auto" />}
    </SidebarRow>
  )
}

/**
 * An agent (Claude/Codex) row: shows its conversation title, a status dot that
 * stays "working" while the lead OR any sub-agent is active, and an
 * expand/collapse chevron over its sub-agent child rows.
 */
function AgentRow({ session }: { session: Session }): JSX.Element {
  const id = session.id
  const isActive = useApp((s) => s.activeSessionId === id)
  const leadState = useApp((s) => s.sessionState[id] ?? 'idle')
  // This agent is waiting on the operator if a browser it owns has a pending ask.
  const asking = useApp((s) => s.browsers.some((b) => b.owner === id && b.id in s.browserAsks))
  const subs = useApp((s) => s.subagents[id])
  const setActiveSession = useApp((s) => s.setActiveSession)
  const setActiveView = useApp((s) => s.setActiveView)
  const [collapsed, setCollapsed] = useState(false)

  const list = subs ?? []
  // Derive the recursive lineage tree in the component body (never in a
  // selector) so the store keeps returning a stable array ref.
  const tree = buildSubagentTree(list)
  const hasSubs = tree.length > 0
  // Parent stays working while its own hook stream is working OR any sub-agent
  // anywhere in the tree runs (freshness propagates up the lineage).
  const working = leadState === 'working' || anySubtreeWorking(tree)

  return (
    <div>
      <div
        className={sidebarRowClass(isActive, 'h-[30px] gap-1 focus-within:ring-[3px] focus-within:ring-ring/50')}
      >
        <button
          type="button"
          onClick={() => {
            setActiveSession(id)
            setActiveView('terminals')
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 outline-none"
        >
          <AgentIcon agent={session.agent} className="size-4 shrink-0" />
          <span className="truncate">{session.title ?? session.label}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {asking && (
              <span
                data-session-ask
                title="Waiting on you in the browser"
                className="size-2 shrink-0 animate-pulse rounded-full bg-attention"
              />
            )}
            <AgentStatusDot state={working ? 'working' : 'idle'} />
          </span>
        </button>
        {hasSubs && (
          <button
            type="button"
            aria-label={collapsed ? 'Expand sub-agents' : 'Collapse sub-agents'}
            onClick={() => setCollapsed((c) => !c)}
            className="-mr-1 grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')} strokeWidth={2} />
          </button>
        )}
      </div>
      {hasSubs && !collapsed && <SubagentChildren nodes={tree} />}
    </div>
  )
}

/**
 * The live workspace: every open session in one list — agents (with their
 * status dots and sub-agent trees) above plain terminals. They used to be two
 * labelled blocks with a "+" each; one list keeps the sidebar quiet and matches
 * how the workspace tabs already mix them.
 */
export function SessionsSection(): JSX.Element {
  const sessions = useApp((s) => s.sessions)
  const files = useApp((s) => s.files)
  const agents = sessions.filter((x) => x.agent !== 'shell')
  const shells = sessions.filter((x) => x.agent === 'shell')
  const setActiveView = useApp((s) => s.setActiveView)
  // The workspace is empty only when nothing at all is open (no sessions, no
  // files). Then the "+" also lands on the empty workspace with its launchers,
  // while still opening the spawn menu like it does everywhere else.
  const workspaceEmpty = sessions.length === 0 && files.length === 0

  return (
    <>
      <div className="flex items-center justify-between">
        <SectionLabel>Sessions</SectionLabel>
        <SpawnMenu>
          <Button
            variant="ghost"
            size="icon-xs"
            className="mt-2.5 text-tertiary-foreground hover:text-foreground"
            aria-label="New session"
            onClick={workspaceEmpty ? () => setActiveView('terminals') : undefined}
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </Button>
        </SpawnMenu>
      </div>
      {sessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-tertiary-foreground">No sessions running.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {agents.map((s) => (
            <AgentRow key={s.id} session={s} />
          ))}
          {shells.map((s) => (
            <SessionRow key={s.id} id={s.id} label={s.label} icon={TerminalSquare} />
          ))}
        </div>
      )}
    </>
  )
}
