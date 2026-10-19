import type { AxiosInstance } from 'axios'

/** One agent's install/version status (mirrors the engine's /agents row). */
export interface AgentStatus {
  id: string
  name: string
  binary: string
  installed: boolean
  /** A version string when the CLI reported one, else null. */
  version: string | null
  /** A short reason when not installed / probe failed, else null. */
  error: string | null
}

export const agentsApi = (client: AxiosInstance) => ({
  /** Probe every agent's CLI availability (validated on the Agents page mount). */
  list: () => client.get<AgentStatus[]>('/agents').then((r) => r.data),
  /** Re-check a single agent (the per-card Verify button). */
  verify: (id: string) => client.get<AgentStatus>(`/agents/${encodeURIComponent(id)}`).then((r) => r.data),
})
