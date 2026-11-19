import type { JSX } from 'react'
import { useApp } from '../../store.js'
import type { Session } from '../../store/types.js'
import type { EngineConnection } from '../../lib/connection.js'
import { AGENT_LABELS } from '../../lib/agent-labels.js'
import { AgentStatusDot } from '../../components/brand/AgentStatusDot.js'
import { Terminal } from '../../components/terminal/Terminal.js'
import { TeamPanel, isTeamSession } from '../../components/TeamPanel.js'

/**
 * The thin row along the top of a terminal card: what is running, where, and
 * whether it is working. A team session shows its team strip here instead.
 */
function TerminalStatusRow({ session }: { session: Session }): JSX.Element {
  const root = useApp((s) => s.activeRoot)
  const state = useApp((s) => s.sessionState[session.id] ?? 'idle')
  const shell = session.agent === 'shell'
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-glass-border px-4 text-xs text-muted-foreground">
      <span className="shrink-0 font-mono text-foreground">{shell ? session.label : (AGENT_LABELS[session.agent] ?? session.agent)}</span>
      {root !== null && <span className="min-w-0 flex-1 truncate font-mono">{root}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <AgentStatusDot state={state} />
        {state === 'working' ? 'Working' : 'Idle'}
      </span>
    </div>
  )
}

/**
 * The inside of a terminal pane card: the status row (or the team strip) over
 * the terminal. The terminal's host keeps a plain padded box around it, so the
 * fit addon measures the same element it always has; the card's radius and
 * border live on the pane, which clips.
 */
export function TerminalPane({ connection, session }: { connection: EngineConnection; session: Session }): JSX.Element {
  const closeSession = useApp((s) => s.closeSession)
  const pulseSession = useApp((s) => s.pulseSession)
  const shell = session.agent === 'shell'
  return (
    <>
      {isTeamSession(session.agent) ? <TeamPanel sessionId={session.id} agent={session.agent} /> : <TerminalStatusRow session={session} />}
      <div className="relative min-h-0 flex-1 px-3 py-2">
        <Terminal
          connection={connection}
          sessionId={session.id}
          // Shells infer activity from output; agents report real status via hooks.
          onActivity={shell ? () => pulseSession(session.id) : undefined}
          onExit={() => closeSession(session.id)}
          // Agent TUIs take a multi-line prompt; a shell's Shift+Enter stays an ordinary Enter.
          multilineShiftEnter={!shell}
        />
      </div>
    </>
  )
}
