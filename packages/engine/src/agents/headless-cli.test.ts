import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HEADLESS_CLI_RESTRICTION, HeadlessCliRefused, OPENCODE_HEADLESS_AGENT, headlessCliLaunch } from './headless-cli.js'
import { LaunchCleanup } from './launch-cleanup.js'

function launch(agent: string, allowUnrestricted = false) {
  const cleanup = new LaunchCleanup()
  return { cleanup, ...headlessCliLaunch(agent, 'summarise {{ target }}', { allowUnrestricted, defer: cleanup.defer }) }
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
