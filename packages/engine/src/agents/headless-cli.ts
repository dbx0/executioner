import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeferCleanup } from './launch-cleanup.js'
import type { McpInjection } from '../mcp/agent-mcp-injection.js'

/**
 * How a headless workflow agent node launches each non-Claude CLI, with that
 * CLI's own built-in tools (shell, file edits, web) cut down as far as it allows.
 *
 * A headless agent node reads target output nobody vets, so its prompt is
 * assumed injectable, and nobody is there to answer an approval prompt. Each
 * CLI is launched in the most restrictive mode that still prints an answer:
 *
 * - codex: `exec` with a read-only sandbox (no writes, no network), approval
 *   `never` (exec's own default, made explicit), web search disabled, the shell
 *   tool and the app, plugin, browser, computer-use and sub-agent features off,
 *   and the user's config.toml and exec-policy rules ignored, so no
 *   user-configured MCP server or allow rule loads. Auth still comes from
 *   CODEX_HOME. The project server, when wired, exposes only the node's tools.
 * - gemini: `-p` is non-interactive, where anything needing approval is denied.
 *   An admin-tier policy (beats user, workspace and yolo rules) denies every
 *   tool except reading files and the node's project tools, so its shell,
 *   write, edit, web fetch, web search and sub-agent tools are denied;
 *   `--policy` points the user policy dir at an empty one, extensions are off,
 *   and the project server is the only MCP server name allowed. (Gemini
 *   ignores --admin-policy if /etc/gemini-cli/policies already holds admin
 *   rules; those are the machine owner's, and still outrank the user's.)
 * - cursor and hermes cannot be fully restricted per launch (see
 *   {@link HEADLESS_CLI_RESTRICTION}), so a node refuses them unless it opts in
 *   with `allow_unrestricted_cli`. Opted in, they still get the tightest flags
 *   available.
 *
 * Every CLI but hermes may also get the project MCP server, limited to the
 * workflow profile's tools, through the injection handed to
 * {@link headlessCliLaunch}.
 *
 * opencode is restricted through its config (see buildAgentMcpInjection) and
 * claude through `--allowedTools`; both are launched by the caller.
 */

/** Whether a CLI's headless launch is fully restricted, or needs a per-node opt-in. */
export const HEADLESS_CLI_RESTRICTION: Record<string, 'restricted' | 'opt-in'> = {
  claude: 'restricted',
  opencode: 'restricted',
  codex: 'restricted',
  gemini: 'restricted',
  // Headless cursor-agent denies anything that needs approval, but commands a
  // user or project cli.json allow-lists still run, and ask mode may still
  // offer a read-only shell.
  cursor: 'opt-in',
  // Hermes has no read-only file toolset, its oneshot mode forces yolo, and
  // only its troubleshooting safe mode keeps user MCP servers out, which also
  // drops the configured model.
  hermes: 'opt-in',
}

/** The opencode agent a headless run uses; its permissions are set per launch. */
export const OPENCODE_HEADLESS_AGENT = 'executioner-headless'

export interface HeadlessCliLaunch {
  argv: string[]
  env?: Record<string, string>
}

/** Thrown when a node asks for a CLI that cannot run headless without its opt-in. */
export class HeadlessCliRefused extends Error {}

/**
 * The codex flags that lock a headless run down, valid on both `codex exec`
 * and `codex exec resume` (which has no `--sandbox`, hence `sandbox_mode`).
 * Shared with the assistant.
 */
export function codexHeadlessFlags(): string[] {
  return [
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--ephemeral',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"',
    '-c',
    'web_search="disabled"',
    '--disable',
    'shell_tool',
    '--disable',
    'apps',
    '--disable',
    'plugins',
    '--disable',
    'browser_use',
    '--disable',
    'computer_use',
    '--disable',
    'multi_agent',
  ]
}

/** Gemini tools that only read files, which a headless run keeps. */
export const GEMINI_READ_TOOLS = ['read_file', 'read_many_files', 'glob', 'grep_search', 'list_directory']

function tempDir(defer: DeferCleanup, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  defer(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function geminiLaunch(prompt: string, defer: DeferCleanup, mcp: McpInjection | undefined): HeadlessCliLaunch {
  const projectTools = mcp?.tools ?? []
  const dir = tempDir(defer, 'exe-gemini-')
  // A directory passed to --admin-policy is loaded at the admin tier, which
  // outranks the user, workspace and default (yolo) tiers.
  const adminPolicies = join(dir, 'admin')
  mkdirSync(adminPolicies)
  writeFileSync(
    join(adminPolicies, 'headless.toml'),
    [
      '[[rule]]',
      'toolName = "*"',
      'decision = "deny"',
      'priority = 100',
      '',
      '[[rule]]',
      `toolName = [${GEMINI_READ_TOOLS.map((t) => `"${t}"`).join(', ')}]`,
      'decision = "allow"',
      'priority = 200',
      '',
      // `mcpName` scopes the rule to the project server, so a same-named tool
      // on any other server stays denied.
      ...(projectTools.length === 0
        ? []
        : [
            '[[rule]]',
            'mcpName = "project"',
            `toolName = [${projectTools.map((t) => `"${t}"`).join(', ')}]`,
            'decision = "allow"',
            'priority = 200',
            '',
          ]),
    ].join('\n'),
  )
  // Replaces the user policy dir (~/.gemini/policies) for this launch.
  const emptyPolicies = join(dir, 'policies')
  mkdirSync(emptyPolicies)
  return {
    ...(mcp?.env === undefined ? {} : { env: mcp.env }),
    argv: [
      'gemini',
      '--approval-mode',
      'default',
      '--extensions',
      'none',
      // Only the project server loads; without it, no MCP server carries this
      // name, so none of the user's servers load.
      '--allowed-mcp-server-names',
      projectTools.length === 0 ? 'executioner-none' : 'project',
      '--admin-policy',
      adminPolicies,
      '--policy',
      emptyPolicies,
      '--output-format',
      'text',
      `--prompt=${prompt}`,
    ],
  }
}

function cursorLaunch(prompt: string, defer: DeferCleanup, mcp: McpInjection | undefined): HeadlessCliLaunch {
  // cursor-agent reads its permissions from CURSOR_CONFIG_DIR; auth lives
  // elsewhere, so a per-launch dir carries a deny-everything config only.
  const dir = tempDir(defer, 'exe-cursor-')
  const projectTools = mcp?.tools ?? []
  // A deny always beats an allow, so with the project server wired the blanket
  // MCP deny gives way to allowing its tools by name. Any other server's tool
  // is then not allow-listed, and headless denies what needs approval.
  writeFileSync(
    join(dir, 'cli-config.json'),
    JSON.stringify({
      version: 1,
      approvalMode: 'allowlist',
      permissions: {
        allow: projectTools.map((tool) => `Mcp(project:${tool})`),
        deny: ['Shell(*)', 'Write(**)', 'WebFetch(*)', ...(projectTools.length === 0 ? ['Mcp(*:*)'] : [])],
      },
      autoAcceptWebSearch: false,
    }),
  )
  // Never --force/--yolo/--auto-review: without them headless denies anything
  // that needs approval. The injection's --approve-mcps only lets the servers
  // load; their tools still answer to the permissions above.
  return {
    argv: ['cursor-agent', '-p', '--output-format', 'text', '--mode', 'ask', '--trust', ...(mcp?.args ?? []), prompt],
    env: { CURSOR_CONFIG_DIR: dir, ...mcp?.env },
  }
}

/**
 * The argv (and env) for a headless workflow agent node running `agent`, or
 * a {@link HeadlessCliRefused} when the CLI cannot be restricted and the node
 * has not opted in. Not for claude, which the caller wires with its MCP flags.
 * `mcp` builds the project MCP injection; it is only called once the launch is
 * allowed, so a refused node never gets a token.
 */
export function headlessCliLaunch(
  agent: string,
  prompt: string,
  options: { allowUnrestricted: boolean; defer: DeferCleanup; mcp?: () => McpInjection | undefined },
): HeadlessCliLaunch {
  if (HEADLESS_CLI_RESTRICTION[agent] === 'opt-in' && !options.allowUnrestricted) {
    throw new HeadlessCliRefused(
      `${agent} cannot be limited to read-only tools when it runs headless, so this agent node will not run it. ` +
        `Pick claude, codex, gemini or opencode, or turn on "allow_unrestricted_cli" on the node to accept that ${agent} may run commands.`,
    )
  }
  // hermes takes no project MCP, and an unknown CLI is refused below.
  const mcp = agent === 'hermes' || HEADLESS_CLI_RESTRICTION[agent] === undefined ? undefined : options.mcp?.()
  const env = mcp?.env === undefined ? {} : { env: mcp.env }
  switch (agent) {
    case 'codex':
      // The server's -c flags go before `--`, after which everything is the prompt.
      return {
        argv: ['codex', 'exec', '--sandbox', 'read-only', ...codexHeadlessFlags(), ...(mcp?.args ?? []), '--', prompt],
        ...env,
      }
    case 'opencode':
      // Its permissions arrive through OPENCODE_CONFIG_CONTENT, which defines this agent.
      return { argv: ['opencode', 'run', '--agent', OPENCODE_HEADLESS_AGENT, prompt], ...env }
    case 'gemini':
      return geminiLaunch(prompt, options.defer, mcp)
    case 'cursor':
      return cursorLaunch(prompt, options.defer, mcp)
    case 'hermes':
      // Only the empty context_engine toolset: no terminal, file, web or
      // browser tools. Never --yolo or the oneshot mode, which forces it.
      return { argv: ['hermes', 'chat', `--query=${prompt}`, '-Q', '--toolsets', 'context_engine'] }
    default:
      throw new HeadlessCliRefused(`${agent} is not a known agent CLI`)
  }
}
