import type { AxiosInstance } from 'axios'

export type SavedAgentScope = 'local' | 'global'

/** One sub-agent in a team roster (present only on team agents). */
export interface SavedAgentMember {
  name: string
  description: string
  prompt: string
  model?: string
  tools?: string[]
}

/** A reusable agent definition the user can manage and run against targets. */
export interface SavedAgent {
  id: string
  name: string
  description: string
  agent: string
  prompt: string
  model?: string
  tools?: string[]
  members?: SavedAgentMember[]
  scope: SavedAgentScope
  createdAt: string
  updatedAt: string
}

/** Body for create/update. `scope` decides which store holds the agent. */
export interface SavedAgentInput {
  name: string
  description?: string
  agent: string
  prompt: string
  model?: string
  tools?: string[]
  members?: SavedAgentMember[]
  scope: SavedAgentScope
}

/** The base CLIs that can run a team (a lead that delegates to sub-agents). */
export type TeamBase = 'claude' | 'opencode'

/** Matches a team agent string: `<base>-team` or `<base>-team:<id>`. */
const TEAM_RE = /^(claude|opencode)-team(?::.*)?$/

/** True when an agent string denotes a team (Claude or opencode). */
export function isTeamAgentString(agent: string): boolean {
  return TEAM_RE.test(agent)
}

/** True when a saved agent is a team (a lead launch with a member roster). */
export function isTeamSavedAgent(a: SavedAgent): boolean {
  return isTeamAgentString(a.agent)
}

/** The base CLI a team agent string launches (defaults to claude). */
export function teamBaseOf(agent: string): TeamBase {
  return agent.startsWith('opencode-team') ? 'opencode' : 'claude'
}

export const savedAgentsApi = (client: AxiosInstance) => ({
  list: () => client.get<{ agents: SavedAgent[] }>('/saved-agents').then((r) => r.data.agents),
  create: (body: SavedAgentInput) => client.post<SavedAgent>('/saved-agents', body).then((r) => r.data),
  update: (id: string, body: SavedAgentInput) =>
    client.put<SavedAgent>(`/saved-agents/${id}`, body).then((r) => r.data),
  remove: (id: string) => client.delete(`/saved-agents/${id}`).then((r) => r.data),
})
