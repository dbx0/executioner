import type { AxiosInstance } from 'axios'

/** Models an agent can be pinned to; `source` says whether they came from the
 *  agent's CLI, a known alias set, or couldn't be listed. */
export interface AgentModelsResult {
  agent: string
  models: string[]
  source: 'cli' | 'known' | 'none'
}

export const agentModelsApi = (client: AxiosInstance) => ({
  list: (agent: string) =>
    client.get<AgentModelsResult>('/agent-models', { params: { agent } }).then((r) => r.data),
})
