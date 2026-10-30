import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HEADLESS_CLI_RESTRICTION, HeadlessCliRefused, OPENCODE_HEADLESS_AGENT, headlessCliLaunch } from './headless-cli.js'
import { LaunchCleanup } from './launch-cleanup.js'
import type { McpInjection } from '../mcp/agent-mcp-injection.js'

function launch(agent: string, allowUnrestricted = false, mcp?: McpInjection) {
  const cleanup = new LaunchCleanup()
  return {
    cleanup,
    ...headlessCliLaunch(agent, 'summarise {{ target }}', {
      allowUnrestricted,
      defer: cleanup.defer,
      ...(mcp === undefined ? {} : { mcp: () => mcp }),
    }),
  }
}

/** A project MCP injection limited to two workflow tools. */
const PROJECT_MCP: McpInjection = {
  env: { EXECUTIONER_MCP_TOKEN: 'tok' },
  args: ['--project-flag'],
  tools: ['list_targets', 'set_node_output'],
}

/** The value that follows `flag` in an argv. */
function after(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i === -1 ? undefined : argv[i + 1]
}

describe('headless codex', () => {
  it('runs exec in a read-only sandbox with no shell, web search, user config or rules', () => {
    const { argv } = launch('codex')
    expect(argv.slice(0, 2)).toEqual(['codex', 'exec'])
    expect(after(argv, '--sandbox')).toBe('read-only')
    expect(argv).toContain('sandbox_mode="read-only"')
    expect(argv).toContain('approval_policy="never"')
    expect(argv).toContain('web_search="disabled"')
    for (const feature of ['shell_tool', 'apps', 'plugins', 'browser_use', 'computer_use', 'multi_agent']) {
      expect(argv.some((a, i) => a === '--disable' && argv[i + 1] === feature)).toBe(true)
    }
    expect(argv).toContain('--ignore-user-config')
    expect(argv).toContain('--ignore-rules')
    expect(argv).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    // The prompt is a positional after `--`, so one starting with a dash is not a flag.
    expect(argv.slice(-2)).toEqual(['--', 'summarise {{ target }}'])
  })

  it('puts the project server flags before the prompt separator and passes its env', () => {
    const { argv, env } = launch('codex', false, PROJECT_MCP)
    expect(argv.slice(-3)).toEqual(['--project-flag', '--', 'summarise {{ target }}'])
    expect(env).toEqual({ EXECUTIONER_MCP_TOKEN: 'tok' })
  })
})

describe('headless gemini', () => {
  it('denies every tool but file reads at the admin tier and loads no user policy, extension or MCP server', () => {
    const { argv, cleanup } = launch('gemini')
    expect(argv[0]).toBe('gemini')
    expect(after(argv, '--approval-mode')).toBe('default')
    expect(after(argv, '--extensions')).toBe('none')
    expect(after(argv, '--allowed-mcp-server-names')).toBe('executioner-none')
    expect(argv).not.toContain('--yolo')
    expect(argv).not.toContain('-y')
    const adminDir = after(argv, '--admin-policy') ?? ''
    const policy = readFileSync(join(adminDir, 'headless.toml'), 'utf8')
    expect(policy).toMatch(/toolName = "\*"\ndecision = "deny"/)
    const allowed = /toolName = \[(.*)\]\ndecision = "allow"/.exec(policy)?.[1] ?? ''
    for (const tool of ['run_shell_command', 'write_file', 'replace', 'web_fetch', 'google_web_search']) {
      expect(allowed).not.toContain(tool)
    }
    expect(allowed).toContain('read_file')
    const userPolicies = after(argv, '--policy') ?? ''
    expect(readdirSync(userPolicies)).toEqual([])
    expect(argv.at(-1)).toBe('--prompt=summarise {{ target }}')

    cleanup.run()
    expect(existsSync(adminDir)).toBe(false)
  })

  it('allows only the project server, and only its node tools, when it is wired', () => {
    const { argv, env } = launch('gemini', false, PROJECT_MCP)
    expect(after(argv, '--allowed-mcp-server-names')).toBe('project')
    expect(env).toEqual({ EXECUTIONER_MCP_TOKEN: 'tok' })
    const policy = readFileSync(join(after(argv, '--admin-policy') ?? '', 'headless.toml'), 'utf8')
    expect(policy).toMatch(/toolName = "\*"\ndecision = "deny"/)
    expect(policy).toContain('mcpName = "project"\ntoolName = ["list_targets", "set_node_output"]\ndecision = "allow"')
  })
})

describe('headless opencode', () => {
  it('runs as the locked-down agent its injected config defines', () => {
    expect(launch('opencode').argv).toEqual(['opencode', 'run', '--agent', OPENCODE_HEADLESS_AGENT, 'summarise {{ target }}'])
  })
})

describe('CLIs that cannot be restricted headless', () => {
  it.each(['cursor', 'hermes'])('refuses %s unless the node opts in', (agent) => {
    expect(HEADLESS_CLI_RESTRICTION[agent]).toBe('opt-in')
    expect(() => launch(agent)).toThrow(HeadlessCliRefused)
    // A refused node never builds its MCP injection, so it never gets a token.
    let built = false
    const cleanup = new LaunchCleanup()
    const mcp = () => {
      built = true
      return PROJECT_MCP
    }
    expect(() => headlessCliLaunch(agent, 'x', { allowUnrestricted: false, defer: cleanup.defer, mcp })).toThrow(HeadlessCliRefused)
    expect(built).toBe(false)
    expect(() => launch(agent)).toThrow(/allow_unrestricted_cli/)
    // User-facing text never carries an em dash.
    expect(() => launch(agent)).toThrow(/^[^—]*$/)
  })

  it('still gives an opted-in cursor a deny-all permission config and no force flags', () => {
    const { argv, env, cleanup } = launch('cursor', true)
    expect(argv.slice(0, 2)).toEqual(['cursor-agent', '-p'])
    expect(after(argv, '--mode')).toBe('ask')
    for (const flag of ['--force', '-f', '--yolo', '--approve-mcps', '--auto-review']) expect(argv).not.toContain(flag)
    const config = JSON.parse(readFileSync(join(env?.CURSOR_CONFIG_DIR ?? '', 'cli-config.json'), 'utf8')) as {
      permissions: { allow: string[]; deny: string[] }
    }
    expect(config.permissions.allow).toEqual([])
    expect(config.permissions.deny).toEqual(expect.arrayContaining(['Shell(*)', 'Write(**)', 'WebFetch(*)', 'Mcp(*:*)']))
    cleanup.run()
    expect(existsSync(env?.CURSOR_CONFIG_DIR ?? '')).toBe(false)
  })

  it('allows an opted-in cursor only the node tools of the project server', () => {
    const { argv, env } = launch('cursor', true, PROJECT_MCP)
    expect(argv.slice(-2)).toEqual(['--project-flag', 'summarise {{ target }}'])
    expect(env).toMatchObject({ EXECUTIONER_MCP_TOKEN: 'tok', CURSOR_CONFIG_DIR: expect.any(String) })
    const config = JSON.parse(readFileSync(join(env?.CURSOR_CONFIG_DIR ?? '', 'cli-config.json'), 'utf8')) as {
      permissions: { allow: string[]; deny: string[] }
    }
    expect(config.permissions.allow).toEqual(['Mcp(project:list_targets)', 'Mcp(project:set_node_output)'])
    // A deny beats an allow in cursor, so the blanket MCP deny has to go.
    expect(config.permissions.deny).toEqual(['Shell(*)', 'Write(**)', 'WebFetch(*)'])
  })

  it('never wires the project MCP into hermes', () => {
    expect(launch('hermes', true, PROJECT_MCP).env).toBeUndefined()
  })

  it('still gives an opted-in hermes no toolset and never yolo', () => {
    const { argv } = launch('hermes', true)
    expect(after(argv, '--toolsets')).toBe('context_engine')
    expect(argv).not.toContain('--yolo')
    expect(argv).not.toContain('-z')
    expect(argv).not.toContain('--oneshot')
  })
})

describe('every agent the node offers', () => {
  it('has a headless restriction verdict', () => {
    for (const agent of ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'hermes']) {
      expect(HEADLESS_CLI_RESTRICTION[agent]).toBeDefined()
    }
  })
})
