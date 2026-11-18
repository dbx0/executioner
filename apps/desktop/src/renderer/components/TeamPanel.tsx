import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useApp } from '../store.js'
import { ClaudeLogo } from './brand/ClaudeLogo.js'
import { TeamIcon } from './brand/TeamIcon.js'
import { teamsApi, teamIdFromAgent, type TeamSummary } from '../api/teams.js'
import { Button } from './ui/button.js'
import { deriveMemberActivity, unmatchedSubagentCount, type MemberStatus } from '../lib/team-status.js'

/** The spinner/check/neutral glyph for a member's live status. */
function StatusGlyph({ status }: { status: MemberStatus }): JSX.Element {
  if (status === 'working') {
    return (
      <span
        role="img"
        className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-activity border-t-transparent"
        aria-label="working"
      />
    )
  }
  if (status === 'done') {
    return <Check className="size-3 shrink-0 text-status-success motion-safe:animate-pop" strokeWidth={2.5} aria-label="done" />
  }
  return <span role="img" className="size-2 shrink-0 rounded-full bg-tertiary-foreground" aria-label="idle" />
}

/**
 * The Claude Agent Team strip: a glass band along the top of a team session's
 * terminal card, showing the lead Claude plus a chip per roster member with its
 * live status. Member status is derived from the session's real sub-agent
 * lifecycle events (never faked): a member is "working" while a matching
 * sub-agent runs, "done" once one has finished, and idle until dispatched.
 * Collapsing it leaves only the summary row.
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
    <section
      aria-label={`${team.name} team`}
      className="mx-2.5 mt-2.5 flex shrink-0 flex-col gap-2 rounded-[14px] border border-glass-border bg-glass px-3 py-2 text-xs shadow-glass"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? 'Expand team' : 'Collapse team'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronRight className="size-3" strokeWidth={2} /> : <ChevronDown className="size-3" strokeWidth={2} />}
        </Button>
        <TeamIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-semibold text-foreground">{team.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{team.description}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {workingMembers > 0 ? `${workingMembers} active` : `${team.members.length} members`}
          {extraTasks > 0 ? ` · ${extraTasks} task${extraTasks === 1 ? '' : 's'}` : ''}
        </span>
        {/* The lead Claude, with its own live status. */}
        <span className="flex shrink-0 items-center gap-1.5 rounded-control bg-glass-strong py-0.5 pl-1.5 pr-2 text-[11px]">
          <ClaudeLogo className="size-3.5" />
          <span className="font-medium text-foreground">Lead</span>
          <span className="text-muted-foreground">Claude</span>
          <StatusGlyph status={leadState === 'working' ? 'working' : 'idle'} />
        </span>
      </div>

      {!collapsed && activity.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-1.5">
          {activity.map(({ member, status, activeCount }) => (
            <li key={member.name} className="flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-background/45 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-foreground">{member.label}</span>
                {member.model !== 'inherit' && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{member.model}</span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {activeCount > 1 && <span className="text-[10px] tabular-nums text-muted-foreground">×{activeCount}</span>}
                  <StatusGlyph status={status} />
                </span>
              </div>
              <span className="truncate text-[11px] text-muted-foreground">{member.description}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** True when a terminal session's agent string denotes a Claude Agent Team. */
export function isTeamSession(agent: string): boolean {
  return teamIdFromAgent(agent) !== null
}
