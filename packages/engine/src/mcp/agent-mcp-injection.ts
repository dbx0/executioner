/**
 * Per-launch MCP injection for the agent CLIs other than Claude, so the engine
 * can point a spawned agent at the project MCP server without persisting the
 * per-launch scoped token anywhere on disk.
 *
 * Claude is deliberately absent: it has its own injection path
 * (`writeAgentMcpConfig` + `--mcp-config`). This map covers the *other* agents:
 *
 * - opencode: inline config JSON in an env var.
 * - codex: `-c mcp_servers.project.*` flags, the token read from an env var.
 * - gemini and cursor: a `project` entry merged into the launch directory's
 *   workspace config (`.gemini/settings.json`, `.cursor/mcp.json`). Both CLIs
 *   expand an env var reference in a header, so the file names the token's
 *   variable and never holds the token itself.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TOOL_ACCESS, type ToolName } from './toolset.js'
import { OPENCODE_HEADLESS_AGENT } from '../agents/headless-cli.js'

export interface McpInjection {
  /** Extra environment for the spawned process (merged onto the inherited env). */
  env?: Record<string, string>
  /** Extra argv appended to the agent's command line. */
  args?: string[]
  /**
   * The project tools the agent was wired with, present only when the project
   * MCP server is. A headless launch opens its CLI's own lockdown to exactly
   * these (see headless-cli.ts).
   */
  tools?: readonly ToolName[]
}

/** The env var that carries the scoped token to codex, gemini and cursor. */
export const MCP_TOKEN_ENV = 'EXECUTIONER_MCP_TOKEN'

/**
 * The agents this module can inject the project MCP into via env/flags. Drives
 * which agent cards show a "Project MCP" toggle. Kept in sync with the cases in
 * `buildAgentMcpInjection` (asserted by its tests).
 */
export const MCP_INJECTABLE_AGENTS: readonly string[] = ['opencode', 'codex', 'gemini', 'cursor']

/** True when `buildAgentMcpInjection` can wire the project MCP into `agent`. */
export function isMcpInjectableAgent(agent: string): boolean {
  return MCP_INJECTABLE_AGENTS.includes(agent)
}

/** The loopback URL of the project MCP server for a given engine port. */
function projectMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

/**
 * Set `mcpServers.project` in the JSON config at `path`, keeping everything
 * else in it. A file that is not plain JSON (gemini allows comments) is left
 * untouched and the launch goes without the project MCP: returns false.
 */
function upsertProjectServer(path: string, server: Record<string, unknown>): boolean {
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(path)) {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
      config = parsed as Record<string, unknown>
    }
    const servers = config.mcpServers
    const others = typeof servers === 'object' && servers !== null && !Array.isArray(servers) ? servers : {}
    config.mcpServers = { ...others, project: server }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

/**
 * Build the injection for `agent`, or `undefined` when this agent has no
 * injection wired (including claude, which is handled elsewhere). gemini and
 * cursor need `cwd`, the directory they launch in, for their workspace config.
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
    /** The agent's launch directory, where gemini and cursor read workspace config. */
    cwd?: string
  },
): McpInjection | undefined {
  if (agent === 'codex' || agent === 'gemini' || agent === 'cursor') {
    if (input.mcp === undefined) return undefined
    const url = projectMcpUrl(input.mcp.port)
    const allowed = input.mcp.tools
    const env: Record<string, string> = { [MCP_TOKEN_ENV]: input.mcp.token }
    const tools = allowed ?? (Object.keys(TOOL_ACCESS) as ToolName[])
    if (agent === 'codex') {
      // `-c` values are TOML; a JSON string or string array is valid TOML too.
      const args = ['-c', `mcp_servers.project.url=${JSON.stringify(url)}`, '-c', `mcp_servers.project.bearer_token_env_var="${MCP_TOKEN_ENV}"`]
      if (allowed !== undefined) args.push('-c', `mcp_servers.project.enabled_tools=${JSON.stringify(allowed)}`)
      // Headless exec runs with approval_policy "never", which refuses every
      // MCP call that needs approval; the allowed tools are pre-approved, the
      // way claude's --allowedTools are. Verified against codex 0.162.
      if (input.headless === true) args.push('-c', 'mcp_servers.project.default_tools_approval_mode="approve"')
      return { env, args, tools }
    }
    if (input.cwd === undefined) return undefined
    if (agent === 'gemini') {
      // Gemini expands `$VAR` in settings values. Workspace settings load only
      // in a trusted folder, so this launch trusts its own directory.
      const server = {
        httpUrl: url,
        headers: { Authorization: `Bearer $${MCP_TOKEN_ENV}` },
        ...(allowed === undefined ? {} : { includeTools: [...allowed] }),
      }
      if (!upsertProjectServer(join(input.cwd, '.gemini', 'settings.json'), server)) return undefined
      return { env: { ...env, GEMINI_CLI_TRUST_WORKSPACE: 'true' }, tools }
    }
    // cursor expands `${env:VAR}`. Its approval of a server is keyed on the
    // resolved config, token included, so each launch would need approving
    // again: --approve-mcps does it for this session without writing anything.
    const server = { url, headers: { Authorization: `Bearer \${env:${MCP_TOKEN_ENV}}` } }
    if (!upsertProjectServer(join(input.cwd, '.cursor', 'mcp.json'), server)) return undefined
    return { env, args: ['--approve-mcps'], tools }
  }
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
    return input.mcp === undefined ? { env } : { env, tools: allowed ?? (Object.keys(TOOL_ACCESS) as ToolName[]) }
  }
  return undefined
}
