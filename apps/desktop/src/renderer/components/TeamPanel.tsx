import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useApp } from '../store.js'
import { ClaudeLogo } from './brand/ClaudeLogo.js'
import { TeamIcon } from './brand/TeamIcon.js'
import { teamsApi, teamIdFromAgent, type TeamSummary } from '../api/teams.js'
import { deriveMemberActivity, unmatchedSubagentCount, type MemberStatus } from '../lib/team-status.js'

/** The spinner/check/neutral glyph for a member's live status. */
function StatusGlyph({ status }: { status: MemberStatus }): JSX.Element {
  if (status === 'working') {
    return (
      <span
        className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-activity border-t-transparent"
        aria-label="working"
      />
    )
  }
  if (status === 'done') {
    return <Check className="size-3 shrink-0 text-status-success" strokeWidth={2.5} aria-label="done" />
  }
  return <span className="size-2 shrink-0 rounded-full bg-tertiary-foreground" aria-label="idle" />
}

/**
 * The Claude Agent Team panel: a slim, collapsible header over a team session
 * showing the lead Claude plus each roster member's live status. Member status
 * is derived from the session's real sub-agent lifecycle events (never faked):
 * a member is "working" while a matching sub-agent runs, "done" once one has
 * finished, and idle until dispatched. Near-monochrome to match the app tokens.
 */
export function TeamPanel({ sessionId, agent }: { sessionId: string; agent: string }): JSX.Element | null {
  const client = useApp((s) => s.client)
  // Selectors return refs/scalars only; all derivation happens in the body.
  const leadState = useApp((s) => s.sessionState[sessionId] ?? 'idle')
  const subs = useApp((s) => s.subagents[sessionId])
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [collapsed, setCollapsed] = useState(false)

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

  const teamId = teamIdFromAgent(agent)
  // A bare `claude-team` launch (id === '') resolves to the first built-in team,
  // matching the engine's DEFAULT_TEAM_ID.
  const team = useMemo<TeamSummary | undefined>(() => {
    if (teamId === null) return undefined
    if (teamId === '') return teams[0]
    return teams.find((t) => t.id === teamId)
  }, [teams, teamId])

  // Memoised so a missing list is one stable empty array, not a new one per render.
  const list = useMemo(() => subs ?? [], [subs])
  const activity = useMemo(
    () => (team !== undefined ? deriveMemberActivity(team.members, list) : []),
    [team, list],
  )
  const extraTasks = team !== undefined ? unmatchedSubagentCount(team.members, list) : 0
  const workingMembers = activity.filter((a) => a.status === 'working').length

  if (teamId === null) return null
  if (team === undefined) return null

  return (
    <div className="shrink-0 rounded-md border border-border bg-card/60 text-xs">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          aria-label={collapsed ? 'Expand team' : 'Collapse team'}
          onClick={() => setCollapsed((c) => !c)}
          className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="size-3" strokeWidth={2} /> : <ChevronDown className="size-3" strokeWidth={2} />}
        </button>
        <TeamIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{team.name}</span>
        <span className="truncate text-muted-foreground">{team.description}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {workingMembers > 0 ? `${workingMembers} active` : `${team.members.length} members`}
          {extraTasks > 0 ? ` · ${extraTasks} task${extraTasks === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {!collapsed && (
        <div className="border-t border-border px-2.5 py-1.5">
          {/* Lead Claude row. */}
          <div className="flex items-center gap-2 py-1">
            <ClaudeLogo className="size-3.5" />
            <span className="font-medium text-foreground">Lead</span>
            <span className="text-muted-foreground">Claude</span>
            <span className="ml-auto">
              <StatusGlyph status={leadState === 'working' ? 'working' : 'idle'} />
            </span>
          </div>
          {/* Member rows, indented under the lead with a lineage guide-line. */}
          <div className="ml-[0.9rem] flex flex-col border-l border-border pl-2">
            {activity.map(({ member, status, activeCount }) => (
              <div key={member.name} className="flex items-center gap-2 py-1">
                <span
                  className="grid size-4 shrink-0 place-items-center rounded-sm bg-muted text-[9px] font-semibold uppercase text-muted-foreground"
                  aria-hidden
                >
                  {member.label.charAt(0)}
                </span>
                <span className="text-foreground">{member.label}</span>
                {member.model !== 'inherit' && (
                  <span className="rounded bg-muted px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                    {member.model}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{member.description}</span>
                {activeCount > 1 && <span className="shrink-0 text-[10px] text-muted-foreground">×{activeCount}</span>}
                <StatusGlyph status={status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** True when a terminal session's agent string denotes a Claude Agent Team. */
export function isTeamSession(agent: string): boolean {
  return teamIdFromAgent(agent) !== null
}
