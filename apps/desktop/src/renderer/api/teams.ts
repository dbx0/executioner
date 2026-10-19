import type { AxiosInstance } from 'axios'

/** A model alias a team member is pinned to; `inherit` uses the lead's model. */
export type TeamMemberModel = 'inherit' | 'sonnet' | 'opus' | 'haiku'

/** One member of a Claude Agent Team, as summarised by the engine (no prompt). */
export interface TeamMemberSummary {
  name: string
  label: string
  description: string
  model: TeamMemberModel
  /** A tool allowlist, or null when the member inherits the lead's tools. */
  tools: string[] | null
}

/** A Claude Agent Team roster summary (the prompt-free view for the UI). */
export interface TeamSummary {
  id: string
  name: string
  description: string
  members: TeamMemberSummary[]
}

/** The agent-string sentinel for a bare (default) team launch. */
export const TEAM_AGENT_PREFIX = 'claude-team'

/** Build the terminal `agent` string that launches a specific team by id. */
export function teamAgentString(teamId: string): string {
  return `${TEAM_AGENT_PREFIX}:${teamId}`
}

/** Extract a team id from a terminal `agent` string, or null if it isn't a team. */
export function teamIdFromAgent(agent: string): string | null {
  if (agent === TEAM_AGENT_PREFIX) return ''
  const prefix = `${TEAM_AGENT_PREFIX}:`
  return agent.startsWith(prefix) ? agent.slice(prefix.length) : null
}

/** True when a terminal `agent` string denotes a Claude Agent Team launch. */
export function isTeamAgent(agent: string): boolean {
  return teamIdFromAgent(agent) !== null
}

export const teamsApi = (client: AxiosInstance) => ({
  list: () => client.get<TeamSummary[]>('/teams').then((r) => r.data),
})
