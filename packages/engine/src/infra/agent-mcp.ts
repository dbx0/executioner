import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { globalLayout } from '@exe/protocol'

/**
 * The project-MCP wiring config: which agent CLIs get the project MCP server
 * injected at spawn. User-level (`~/.executioner/agent-mcp.json`), like the
 * skills config, so the choice follows you into every engagement.
 *
 * Injection is ON by default: an agent is wired unless its entry is explicitly
 * `false`. A fresh install therefore wires every injectable agent with no file
 * present at all.
 */
export interface AgentMcpWiring {
  enabled: Record<string, boolean>
}

const DEFAULT: AgentMcpWiring = { enabled: {} }

/** Validate/normalize an arbitrary parsed value into an AgentMcpWiring. */
export function normalizeAgentMcpWiring(value: unknown): AgentMcpWiring {
  if (typeof value !== 'object' || value === null) return { enabled: {} }
  const raw = value as Record<string, unknown>
  const enabled: Record<string, boolean> = {}
  if (typeof raw.enabled === 'object' && raw.enabled !== null) {
    for (const [k, v] of Object.entries(raw.enabled as Record<string, unknown>)) {
      if (typeof v === 'boolean') enabled[k] = v
    }
  }
  return { enabled }
}

/** True when `agent` should get the project MCP injected (default on). */
export function isAgentWiringEnabled(config: AgentMcpWiring, agent: string): boolean {
  return config.enabled[agent] !== false
}

/** Read the wiring config, defaulting to an empty (all-on) map on any problem. */
export function readAgentMcpWiring(): AgentMcpWiring {
  try {
    const path = globalLayout.agentMcpConfig()
    if (!existsSync(path)) return { ...DEFAULT }
    return normalizeAgentMcpWiring(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT }
  }
}

/** Persist the wiring config, returning the normalized value that was written. */
export function writeAgentMcpWiring(config: AgentMcpWiring): AgentMcpWiring {
  const normalized = normalizeAgentMcpWiring(config)
  const path = globalLayout.agentMcpConfig()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(normalized, null, 2))
  return normalized
}
