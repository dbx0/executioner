import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROFILE_TOOLS, type AgentProfile } from './toolset.js'

/**
 * Writes a temporary MCP config the agent CLI reads on launch, pointing it at
 * the project MCP server over loopback with the agent's scoped token. Shape targets
 * Claude Code's mcpServers config; confirm against the installed CLI version.
 */
export function writeAgentMcpConfig(input: { port: number; token: string; dir?: string }): string {
  const dir = input.dir ?? mkdtempSync(join(tmpdir(), 'exe-mcp-'))
  const path = join(dir, 'mcp.json')
  const config = {
    mcpServers: {
      project: {
        type: 'http',
        url: `http://127.0.0.1:${input.port}/mcp`,
        headers: { Authorization: `Bearer ${input.token}` },
      },
    },
  }
  // It carries the agent's token, so it is readable by its owner only.
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
  return path
}

/**
 * The `--allowedTools` entries that pre-approve a headless Claude's project
 * tools: one per tool of its profile, never the whole `mcp__project` server.
 * Headless Claude has nobody to answer a permission prompt, so anything not
 * named here is denied by the CLI, and the engine refuses it again server-side.
 */
export function claudeAllowedTools(profile: AgentProfile): string[] {
  return PROFILE_TOOLS[profile].map((tool) => `mcp__project__${tool}`)
}

/**
 * Writes the engagement briefing into the engagement folder and returns its
 * path, for agents that take their system-prompt orientation as a file rather
 * than an inline flag (opencode's `instructions`). It lives at
 * `<root>/.executioner/agent-briefing.md` — inside the engagement, namespaced,
 * and a stable name so each launch overwrites the last snapshot instead of
 * leaving files behind. A headless profile gets its own file
 * (`agent-briefing.<profile>.md`): its briefing lists fewer tools, and sharing
 * one file would let a headless launch and an open terminal overwrite each
 * other's tool list.
 */
export function writeAgentBriefingFile(
  briefing: string,
  engagementRoot: string,
  profile: AgentProfile = 'interactive',
): string {
  const dir = join(engagementRoot, '.executioner')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, profile === 'interactive' ? 'agent-briefing.md' : `agent-briefing.${profile}.md`)
  writeFileSync(path, briefing)
  return path
}
