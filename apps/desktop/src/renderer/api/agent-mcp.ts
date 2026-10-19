import type { AxiosInstance } from 'axios'

/** The persisted project-MCP wiring (mirrors the engine's agent-mcp.json). */
export interface AgentMcpWiring {
  /** Per-agent on/off. Absent = on (injection is enabled by default). */
  enabled: Record<string, boolean>
}

/** Which agents the engine can wire the project MCP into. */
export interface InjectableAgents {
  agents: string[]
}

export const agentMcpApi = (client: AxiosInstance) => ({
  /** The persisted per-agent MCP wiring config. */
  getConfig: () => client.get<AgentMcpWiring>('/agent-mcp/config').then((r) => r.data),
  /** Persist the whole wiring config. */
  setConfig: (config: AgentMcpWiring) =>
    client.put<AgentMcpWiring>('/agent-mcp/config', config).then((r) => r.data),
  /** The agents that support project-MCP injection. */
  injectable: () => client.get<InjectableAgents>('/agent-mcp/injectable').then((r) => r.data),
})

/** True when `agent` is wired for MCP injection (default on when unset). */
export function isWired(config: AgentMcpWiring, agent: string): boolean {
  return config.enabled[agent] !== false
}
