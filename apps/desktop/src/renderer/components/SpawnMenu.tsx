import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { useApp } from '../store.js'
import { ClaudeLogo } from './brand/ClaudeLogo.js'
import { CodexLogo } from './brand/CodexLogo.js'
import { CursorLogo } from './brand/CursorLogo.js'
import { GeminiLogo } from './brand/GeminiLogo.js'
import { HermesLogo } from './brand/HermesLogo.js'
import { OpenCodeLogo } from './brand/OpenCodeLogo.js'
import { TeamIcon } from './brand/TeamIcon.js'
import { teamsApi, teamAgentString, TEAM_AGENT_PREFIX, type TeamSummary } from '../api/teams.js'
import { RunAgentModal, type RunnableAgent } from './modals/RunAgentModal.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

/** Every standalone agent the menu can launch, in display order. Filtered at
 *  render time by the machine-wide installed-agent list. */
const ALL_AGENT_ROWS: { id: string; label: string; Icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'claude', label: 'Claude', Icon: ClaudeLogo },
  { id: 'codex', label: 'Codex', Icon: CodexLogo },
  { id: 'opencode', label: 'OpenCode', Icon: OpenCodeLogo },
  { id: 'gemini', label: 'Gemini', Icon: GeminiLogo },
  { id: 'cursor', label: 'Cursor', Icon: CursorLogo },
  { id: 'hermes', label: 'Hermes', Icon: HermesLogo },
]

/** The "+" menu: choose what kind of session to spawn. */
export function SpawnMenu({
  children,
  align = 'end',
}: {
  children: React.ReactNode
  align?: 'start' | 'end'
}): JSX.Element {
  const createSession = useApp((s) => s.createSession)
  const client = useApp((s) => s.client)
  const installedAgents = useApp((s) => s.installedAgents)
  const [teams, setTeams] = useState<TeamSummary[]>([])
  // A team runs against targets, so picking one opens the same run modal the
  // empty workspace uses instead of launching the lead blind.
  const [runTeam, setRunTeam] = useState<RunnableAgent | null>(null)

  // Only offer agents whose CLI is installed (machine-wide status). Before the
  // check resolves (installedAgents === null) show them all rather than an empty
  // menu; once known, hide the missing ones.
  const has = (id: string): boolean => installedAgents === null || installedAgents.includes(id)
  const agentRows = ALL_AGENT_ROWS.filter((r) => has(r.id))

  // Load the built-in team catalogue once a client is available. A failure just
  // leaves the list empty and falls back to a bare "Claude Team" launch.
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
    </>
  )
}
