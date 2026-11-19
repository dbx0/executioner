import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Bot, Globe, TerminalSquare } from 'lucide-react'
import { useApp } from '../store.js'
import { ClaudeLogo } from './brand/ClaudeLogo.js'
import { CodexLogo } from './brand/CodexLogo.js'
import { CursorLogo } from './brand/CursorLogo.js'
import { GeminiLogo } from './brand/GeminiLogo.js'
import { HermesLogo } from './brand/HermesLogo.js'
import { OpenCodeLogo } from './brand/OpenCodeLogo.js'
import { TeamIcon } from './brand/TeamIcon.js'
import { savedAgentsApi, type SavedAgent } from '../api/saved-agents.js'
import { teamsApi, teamAgentString, TEAM_AGENT_PREFIX, type TeamSummary } from '../api/teams.js'
import { RunAgentModal, runnableChoices, type RunnableAgent } from './modals/RunAgentModal.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

/** Every standalone agent CLI with its logo, in display order. Callers filter it
 *  by the machine-wide installed-agent list. */
export const ALL_AGENT_ROWS: { id: string; label: string; Icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'claude', label: 'Claude', Icon: ClaudeLogo },
  { id: 'codex', label: 'Codex', Icon: CodexLogo },
  { id: 'opencode', label: 'OpenCode', Icon: OpenCodeLogo },
  { id: 'gemini', label: 'Gemini', Icon: GeminiLogo },
  { id: 'cursor', label: 'Cursor', Icon: CursorLogo },
  { id: 'hermes', label: 'Hermes', Icon: HermesLogo },
]

/**
 * The "+" menu. A terminal, a browser and each installed agent CLI open straight
 * away. "Agent" opens the run dialog, which asks which one (an installed CLI, a
 * saved agent or a team), against which targets and on which backend. A team
 * opens the same dialog with the team already chosen.
 */
export function SpawnMenu({
  children,
  align = 'end',
}: {
  children: React.ReactNode
  align?: 'start' | 'end'
}): JSX.Element {
  const createSession = useApp((s) => s.createSession)
  const openBrowser = useApp((s) => s.openBrowser)
  const client = useApp((s) => s.client)
  const installedAgents = useApp((s) => s.installedAgents)
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [saved, setSaved] = useState<SavedAgent[]>([])
  const [pickingAgent, setPickingAgent] = useState(false)
  // A team runs against targets, so picking one opens the run dialog with the
  // team already chosen instead of launching the lead blind.
  const [runTeam, setRunTeam] = useState<RunnableAgent | null>(null)

  // Only offer agents whose CLI is installed (machine-wide status). Before the
  // check resolves (installedAgents === null) show them all rather than an empty
  // menu; once known, hide the missing ones.
  const has = (id: string): boolean => installedAgents === null || installedAgents.includes(id)
  const agentRows = ALL_AGENT_ROWS.filter((r) => has(r.id))

  // Load what can be run once a client is available. A failure just leaves that
  // part of the list empty; the installed CLIs are still offered.
  useEffect(() => {
    if (client === null) return
    let live = true
    void teamsApi(client)
      .list()
      .then((t) => {
        if (live) setTeams(t)
      })
      .catch(() => {
        if (live) setTeams([])
      })
    void savedAgentsApi(client)
      .list()
      .then((a) => {
        if (live) setSaved(a)
      })
      .catch(() => {
        if (live) setSaved([])
      })
    return () => {
      live = false
    }
  }, [client])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          <DropdownMenuLabel>New session</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void createSession({ kind: 'shell' })}>
            <TerminalSquare />
            Terminal
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openBrowser()}>
            <Globe />
            Browser
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPickingAgent(true)}>
            <Bot />
            Agent
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {agentRows.length > 0 && <DropdownMenuLabel>Agents</DropdownMenuLabel>}
          {agentRows.map(({ id, label, Icon }) => (
            <DropdownMenuItem key={id} onSelect={() => void createSession({ agent: id })}>
              <Icon />
              {label}
            </DropdownMenuItem>
          ))}
          {has('claude') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Claude Agent Teams</DropdownMenuLabel>
              {teams.length === 0 ? (
                <DropdownMenuItem
                  onSelect={() => setRunTeam({ name: 'Claude Team', agent: TEAM_AGENT_PREFIX, prompt: '' })}
                >
                  <TeamIcon />
                  Claude Team
                </DropdownMenuItem>
              ) : (
                teams.map((team) => (
                  <DropdownMenuItem
                    key={team.id}
                    title={`${team.description} · ${team.members.map((m) => m.label).join(', ')}`}
                    onSelect={() => setRunTeam({ name: team.name, agent: teamAgentString(team.id), prompt: '' })}
                  >
                    <TeamIcon />
                    {team.name}
                  </DropdownMenuItem>
                ))
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {runTeam !== null && client !== null && (
        <RunAgentModal agent={runTeam} onClose={() => setRunTeam(null)} />
      )}
      {pickingAgent && client !== null && (
        <RunAgentModal
          choices={runnableChoices({ installed: installedAgents, saved, teams })}
          onClose={() => setPickingAgent(false)}
        />
      )}
    </>
  )
}
