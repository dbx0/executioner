import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeferCleanup } from './launch-cleanup.js'

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
 *   CODEX_HOME.
 * - gemini: `-p` is non-interactive, where anything needing approval is denied.
 *   An admin-tier policy (beats user, workspace and yolo rules) denies every
 *   tool except reading files, so its shell, write, edit, web fetch, web
 *   search and sub-agent tools are denied; `--policy` points the user policy
 *   dir at an empty one, extensions are off, and no MCP server name is
 *   allowed. (Gemini ignores --admin-policy if /etc/gemini-cli/policies
 *   already holds admin rules; those are the machine owner's, and still
 *   outrank the user's.)
 * - cursor and hermes cannot be fully restricted per launch (see
 *   {@link HEADLESS_CLI_RESTRICTION}), so a node refuses them unless it opts in
 *   with `allow_unrestricted_cli`. Opted in, they still get the tightest flags
 *   available.
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

function geminiLaunch(prompt: string, defer: DeferCleanup): HeadlessCliLaunch {
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
    ].join('\n'),
  )
  // Replaces the user policy dir (~/.gemini/policies) for this launch.
  const emptyPolicies = join(dir, 'policies')
  mkdirSync(emptyPolicies)
  return {
    argv: [
      'gemini',
      '--approval-mode',
      'default',
      '--extensions',
      'none',
      // No MCP server carries this name, so none of the user's servers load.
      '--allowed-mcp-server-names',
      'executioner-none',
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

function cursorLaunch(prompt: string, defer: DeferCleanup): HeadlessCliLaunch {
  // cursor-agent reads its permissions from CURSOR_CONFIG_DIR; auth lives
  // elsewhere, so a per-launch dir carries a deny-everything config only.
  const dir = tempDir(defer, 'exe-cursor-')
  writeFileSync(
    join(dir, 'cli-config.json'),
    JSON.stringify({
      version: 1,
      approvalMode: 'allowlist',
      permissions: { allow: [], deny: ['Shell(*)', 'Write(**)', 'WebFetch(*)', 'Mcp(*:*)'] },
      autoAcceptWebSearch: false,
    }),
  )
  // Never --force/--yolo/--approve-mcps: without them headless denies anything
  // that needs approval.
  return {
    argv: ['cursor-agent', '-p', '--output-format', 'text', '--mode', 'ask', '--trust', prompt],
    env: { CURSOR_CONFIG_DIR: dir },
  }
}

/**
 * The argv (and env) for a headless workflow agent node running `agent`, or
 * a {@link HeadlessCliRefused} when the CLI cannot be restricted and the node
 * has not opted in. Not for claude, which the caller wires with its MCP flags.
 */
export function headlessCliLaunch(
  agent: string,
  prompt: string,
  options: { allowUnrestricted: boolean; defer: DeferCleanup },
): HeadlessCliLaunch {
  if (HEADLESS_CLI_RESTRICTION[agent] === 'opt-in' && !options.allowUnrestricted) {
    throw new HeadlessCliRefused(
      `${agent} cannot be limited to read-only tools when it runs headless, so this agent node will not run it. ` +
        `Pick claude, codex, gemini or opencode, or turn on "allow_unrestricted_cli" on the node to accept that ${agent} may run commands.`,
    )
  }
  switch (agent) {
    case 'codex':
      return { argv: ['codex', 'exec', '--sandbox', 'read-only', ...codexHeadlessFlags(), '--', prompt] }
    case 'opencode':
      // Its permissions arrive through OPENCODE_CONFIG_CONTENT, which defines this agent.
      return { argv: ['opencode', 'run', '--agent', OPENCODE_HEADLESS_AGENT, prompt] }
    case 'gemini':
      return geminiLaunch(prompt, options.defer)
    case 'cursor':
      return cursorLaunch(prompt, options.defer)
    case 'hermes':
      // Only the empty context_engine toolset: no terminal, file, web or
      // browser tools. Never --yolo or the oneshot mode, which forces it.
      return { argv: ['hermes', 'chat', `--query=${prompt}`, '-Q', '--toolsets', 'context_engine'] }
    default:
      throw new HeadlessCliRefused(`${agent} is not a known agent CLI`)
  }
}
