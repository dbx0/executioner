/**
 * Per-launch MCP injection for the agent CLIs that read their MCP config from an
 * environment variable or launch flag (never a shared file), so the engine can
 * point a spawned agent at the project MCP server without persisting the
 * per-launch scoped token anywhere on disk.
 *
 * Claude is deliberately absent: it has its own injection path
 * (`writeAgentMcpConfig` + `--mcp-config`). This map covers the *other* agents.
 * Codex, Gemini and Cursor are feasible too (Codex via `-c` flags + env, Gemini
 * and Cursor via a per-launch config file in the engagement dir) and can be
 * added here as each is wired end to end.
 */

import { TOOL_ACCESS, type ToolName } from './toolset.js'
import { OPENCODE_HEADLESS_AGENT } from '../agents/headless-cli.js'

export interface McpInjection {
  /** Extra environment for the spawned process (merged onto the inherited env). */
  env?: Record<string, string>
  /** Extra argv appended to the agent's command line. */
  args?: string[]
}

/**
 * The agents this module can inject the project MCP into via env/flags. Drives
 * which agent cards show a "Project MCP" toggle. Kept in sync with the cases in
 * `buildAgentMcpInjection` (asserted by its tests).
 */
export const MCP_INJECTABLE_AGENTS: readonly string[] = ['opencode']

/** True when `buildAgentMcpInjection` can wire the project MCP into `agent`. */
export function isMcpInjectableAgent(agent: string): boolean {
  return MCP_INJECTABLE_AGENTS.includes(agent)
}

/** The loopback URL of the project MCP server for a given engine port. */
function projectMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

/**
 * Build the injection for `agent`, or `undefined` when this agent has no
 * env/flag injection wired (including claude, which is handled elsewhere).
 */
export function buildAgentMcpInjection(
  agent: string,
  input: {
    /** `tools`, when given, is the only project tools the agent may call. */
    mcp?: { port: number; token: string; tools?: readonly ToolName[] }
    instructionsFiles?: string[]
    /**
     * A run nobody watches: launched as the {@link OPENCODE_HEADLESS_AGENT}
     * agent, which may only read files and call the allowed project tools.
     */
    headless?: boolean
  },
): McpInjection | undefined {
  if (agent === 'opencode') {
    // opencode reads inline config JSON from OPENCODE_CONFIG_CONTENT and merges
    // it over the user's own config, so the project server (and any instruction
    // files) are ADDED, not a replacement — opencode concatenates both the `mcp`
    // map and the `instructions` array. `type: 'remote'` is opencode's HTTP/SSE
    // transport; `instructions` are files folded into the system prompt, the
    // closest thing opencode has to Claude's --append-system-prompt.
    //
    // The MCP server and the briefing are independent: an agent can get the
    // briefing (context) without the MCP toolset, so `mcp` and `instructions`
    // are each emitted only when supplied.
    const config: {
      mcp?: Record<string, unknown>
      tools?: Record<string, boolean>
      permission?: Record<string, unknown>
      agent?: Record<string, unknown>
      instructions?: string[]
    } = {}
    if (input.mcp !== undefined) {
      config.mcp = {
        project: {
          type: 'remote',
          url: projectMcpUrl(input.mcp.port),
          enabled: true,
          headers: { Authorization: `Bearer ${input.mcp.token}` },
        },
      }
    }
    const allowed = input.mcp?.tools
    if (input.headless === true) {
      // `opencode run` runs every allowed tool without asking (and rejects an
      // `ask`), so a headless run gets its own agent whose rules deny every
      // tool, then allow reading files and the profile's project tools by
      // their opencode names (`<server>_<tool>`). opencode takes the last rule
      // that matches, and an agent's rules are applied after the user's
      // config, so a user `"bash": "allow"` cannot reopen anything here; a
      // tool whose last match is a `*` deny is not even offered to the model.
      // That covers its shell, edit, write, fetch, web search, sub-agent and
      // skill tools, and every MCP server the user configured. The top-level
      // `*` deny is a second fence should the agent ever not be selected.
      // Verified against opencode 1.19 with `opencode debug agent`.
      const projectTools = input.mcp === undefined ? [] : (allowed ?? (Object.keys(TOOL_ACCESS) as ToolName[]))
      config.permission = { '*': 'deny' }
      config.agent = {
        [OPENCODE_HEADLESS_AGENT]: {
          mode: 'primary',
          description: 'Headless Executioner agent node: reads files and calls its project tools only.',
          permission: {
            '*': 'deny',
            read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny' },
            glob: 'allow',
            grep: 'allow',
            list: 'allow',
            external_directory: 'deny',
            ...Object.fromEntries(projectTools.map((tool) => [`project_${tool}`, 'allow'])),
          },
        },
      }
    } else if (allowed !== undefined) {
      // opencode names an MCP tool `<server>_<tool>`; each project tool outside
      // the allow-list is switched off by name (opencode 1.19 turns each
      // `tools` entry into a permission rule).
      const denied = (Object.keys(TOOL_ACCESS) as ToolName[]).filter((tool) => !allowed.includes(tool))
      if (denied.length > 0) config.tools = Object.fromEntries(denied.map((tool) => [`project_${tool}`, false]))
    }
    if (input.instructionsFiles !== undefined && input.instructionsFiles.length > 0) {
      config.instructions = input.instructionsFiles
    }
    if (config.mcp === undefined && config.instructions === undefined && config.permission === undefined) return undefined
    const env: Record<string, string> = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }
    if (input.headless === true) {
      // Keep a project opencode.json, Claude Code's settings and an
      // auto-update out of a run that must load only the config above.
      env.OPENCODE_DISABLE_PROJECT_CONFIG = '1'
      env.OPENCODE_DISABLE_CLAUDE_CODE = '1'
      env.OPENCODE_DISABLE_AUTOUPDATE = '1'
    }
    return { env }
  }
  return undefined
}
