import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MCP_INJECTABLE_AGENTS,
  MCP_TOKEN_ENV,
  buildAgentMcpInjection,
  isMcpInjectableAgent,
} from './agent-mcp-injection.js'
import { OPENCODE_HEADLESS_AGENT } from '../agents/headless-cli.js'

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'exe-mcp-inject-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

/** The value that follows each `-c` in an argv. */
function codexOverrides(args: string[] | undefined): string[] {
  return (args ?? []).flatMap((a, i, all) => (a === '-c' ? [all[i + 1] ?? ''] : []))
}

/** A workspace config file as the injection leaves it. */
interface WorkspaceConfig {
  model?: unknown
  mcpServers: Record<string, Record<string, unknown>>
}

function readJson(path: string): WorkspaceConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as WorkspaceConfig
}

describe('isMcpInjectableAgent', () => {
  it('is true for agents this module can inject, false otherwise', () => {
    for (const agent of ['opencode', 'codex', 'gemini', 'cursor']) expect(isMcpInjectableAgent(agent)).toBe(true)
    // claude has its own path; hermes has no way to take an MCP server per launch.
    expect(isMcpInjectableAgent('claude')).toBe(false)
    expect(isMcpInjectableAgent('hermes')).toBe(false)
  })

  it('every listed injectable agent actually yields an injection when given an MCP endpoint', () => {
    for (const agent of MCP_INJECTABLE_AGENTS) {
      expect(buildAgentMcpInjection(agent, { mcp: { port: 1, token: 't' }, cwd })).toBeDefined()
    }
  })
})

describe('buildAgentMcpInjection', () => {
  it('wires the project MCP into opencode via OPENCODE_CONFIG_CONTENT', () => {
    const injection = buildAgentMcpInjection('opencode', { mcp: { port: 5123, token: 'tok-abc' } })
    const content = injection?.env?.OPENCODE_CONFIG_CONTENT
    expect(content).toBeDefined()
    expect(JSON.parse(content ?? '')).toEqual({
      mcp: {
        project: {
          type: 'remote',
          url: 'http://127.0.0.1:5123/mcp',
          enabled: true,
          headers: { Authorization: 'Bearer tok-abc' },
        },
      },
    })
    expect(injection?.args).toBeUndefined()
  })

  it('adds briefing files to opencode as instructions alongside the MCP server', () => {
    const injection = buildAgentMcpInjection('opencode', {
      mcp: { port: 5123, token: 'tok-abc' },
      instructionsFiles: ['/tmp/exe-brief.md'],
    })
    const parsed = JSON.parse(injection?.env?.OPENCODE_CONFIG_CONTENT ?? '')
    expect(parsed.instructions).toEqual(['/tmp/exe-brief.md'])
    expect(parsed.mcp.project.url).toBe('http://127.0.0.1:5123/mcp')
  })

  it('injects instructions alone (context, no MCP server) when no endpoint is given', () => {
    const injection = buildAgentMcpInjection('opencode', { instructionsFiles: ['/tmp/exe-brief.md'] })
    const parsed = JSON.parse(injection?.env?.OPENCODE_CONFIG_CONTENT ?? '')
    expect(parsed.instructions).toEqual(['/tmp/exe-brief.md'])
    expect(parsed).not.toHaveProperty('mcp')
  })

  it('switches off every project tool outside an allow-list by its opencode name', () => {
    const injection = buildAgentMcpInjection('opencode', {
      mcp: { port: 5123, token: 'tok-abc', tools: ['list_targets', 'set_node_output'] },
    })
    const parsed = JSON.parse(injection?.env?.OPENCODE_CONFIG_CONTENT ?? '') as { tools: Record<string, boolean> }
    expect(parsed.tools.project_run_command).toBe(false)
    expect(parsed.tools.project_run_workflow).toBe(false)
    expect(parsed.tools.project_add_finding).toBe(false)
    expect(parsed.tools).not.toHaveProperty('project_list_targets')
    expect(parsed.tools).not.toHaveProperty('project_set_node_output')
  })

  it('runs a headless opencode as an agent that denies everything but reads and its project tools', () => {
    const injection = buildAgentMcpInjection('opencode', {
      mcp: { port: 5123, token: 'tok-abc', tools: ['list_targets', 'set_node_output'] },
      headless: true,
    })
    const parsed = JSON.parse(injection?.env?.OPENCODE_CONFIG_CONTENT ?? '') as {
      permission: Record<string, unknown>
      agent: Record<string, { mode: string; permission: Record<string, unknown> }>
      tools?: unknown
    }
    expect(parsed.permission).toEqual({ '*': 'deny' })
    const agent = parsed.agent[OPENCODE_HEADLESS_AGENT]
    expect(agent?.mode).toBe('primary')
    const rules = agent?.permission ?? {}
    // opencode takes the last matching rule, so the catch-all deny comes first.
    expect(Object.keys(rules)[0]).toBe('*')
    expect(rules['*']).toBe('deny')
    expect(rules.project_list_targets).toBe('allow')
    expect(rules.project_set_node_output).toBe('allow')
    for (const denied of ['bash', 'edit', 'write', 'webfetch', 'websearch', 'task', 'skill', 'project_run_command', 'project_add_finding']) {
      expect(rules[denied]).toBeUndefined()
    }
    expect(rules.external_directory).toBe('deny')
    expect(rules.read).toMatchObject({ '*': 'allow', '*.env': 'deny' })
    // A project opencode.json and Claude Code settings stay out of the run.
    expect(injection?.env).toMatchObject({ OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1' })
  })

  it('locks a headless opencode down even without the MCP server', () => {
    const injection = buildAgentMcpInjection('opencode', { headless: true })
    const parsed = JSON.parse(injection?.env?.OPENCODE_CONFIG_CONTENT ?? '') as {
      agent: Record<string, { permission: Record<string, unknown> }>
    }
    const rules = parsed.agent[OPENCODE_HEADLESS_AGENT]?.permission ?? {}
    expect(Object.keys(rules).filter((k) => k.startsWith('project_'))).toEqual([])
    expect(rules['*']).toBe('deny')
  })

  it('returns undefined when there is nothing to inject, and for unmapped agents', () => {
    expect(buildAgentMcpInjection('opencode', {})).toBeUndefined()
    expect(buildAgentMcpInjection('claude', { mcp: { port: 1, token: 't' } })).toBeUndefined()
    expect(buildAgentMcpInjection('hermes', { mcp: { port: 1, token: 't' }, cwd })).toBeUndefined()
    for (const agent of ['codex', 'gemini', 'cursor']) expect(buildAgentMcpInjection(agent, { cwd })).toBeUndefined()
    // gemini and cursor have nowhere to put their workspace config without a cwd.
    expect(buildAgentMcpInjection('gemini', { mcp: { port: 1, token: 't' } })).toBeUndefined()
    expect(buildAgentMcpInjection('cursor', { mcp: { port: 1, token: 't' } })).toBeUndefined()
  })
})

describe('codex injection', () => {
  it('defines the project server with -c flags and hands it the token through an env var only', () => {
    const injection = buildAgentMcpInjection('codex', { mcp: { port: 5123, token: 'tok-abc' }, cwd })
    expect(injection?.env).toEqual({ [MCP_TOKEN_ENV]: 'tok-abc' })
    expect(codexOverrides(injection?.args)).toEqual([
      'mcp_servers.project.url="http://127.0.0.1:5123/mcp"',
      `mcp_servers.project.bearer_token_env_var="${MCP_TOKEN_ENV}"`,
    ])
    expect(injection?.args?.join(' ')).not.toContain('tok-abc')
  })

  it('limits a headless codex to its tools and pre-approves them, as exec never asks', () => {
    const injection = buildAgentMcpInjection('codex', {
      mcp: { port: 5123, token: 'tok-abc', tools: ['list_targets', 'set_node_output'] },
      headless: true,
    })
    expect(codexOverrides(injection?.args)).toEqual(
      expect.arrayContaining([
        'mcp_servers.project.enabled_tools=["list_targets","set_node_output"]',
        'mcp_servers.project.default_tools_approval_mode="approve"',
      ]),
    )
    expect(injection?.tools).toEqual(['list_targets', 'set_node_output'])
  })
})

describe('gemini injection', () => {
  it('adds the project server to the workspace settings by token variable and trusts the folder', () => {
    const injection = buildAgentMcpInjection('gemini', { mcp: { port: 5123, token: 'tok-abc' }, cwd })
    expect(injection?.env).toEqual({ [MCP_TOKEN_ENV]: 'tok-abc', GEMINI_CLI_TRUST_WORKSPACE: 'true' })
    const path = join(cwd, '.gemini', 'settings.json')
    expect(readJson(path).mcpServers.project).toEqual({
      httpUrl: 'http://127.0.0.1:5123/mcp',
      headers: { Authorization: `Bearer $${MCP_TOKEN_ENV}` },
    })
    expect(readFileSync(path, 'utf8')).not.toContain('tok-abc')
  })

  it('keeps the rest of an existing settings file, and lists a headless allow-list', () => {
    mkdirSync(join(cwd, '.gemini'))
    const path = join(cwd, '.gemini', 'settings.json')
    writeFileSync(path, JSON.stringify({ model: { name: 'x' }, mcpServers: { mine: { command: 'm' }, project: { command: 'old' } } }))
    buildAgentMcpInjection('gemini', { mcp: { port: 5123, token: 't', tools: ['list_targets'] }, headless: true, cwd })
    const settings = readJson(path)
    expect(settings.model).toEqual({ name: 'x' })
    expect(settings.mcpServers.mine).toEqual({ command: 'm' })
    expect(settings.mcpServers.project?.includeTools).toEqual(['list_targets'])
    expect(settings.mcpServers.project).not.toHaveProperty('command')
  })

  it('leaves a settings file it cannot parse alone and launches without the server', () => {
    mkdirSync(join(cwd, '.gemini'))
    const path = join(cwd, '.gemini', 'settings.json')
    const original = '{\n  // the user\'s comment\n  "model": {}\n}\n'
    writeFileSync(path, original)
    expect(buildAgentMcpInjection('gemini', { mcp: { port: 5123, token: 't' }, cwd })).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe(original)
  })
})

describe('cursor injection', () => {
  it('adds the project server to the workspace mcp.json by token variable and approves it for the session', () => {
    const injection = buildAgentMcpInjection('cursor', { mcp: { port: 5123, token: 'tok-abc' }, cwd })
    expect(injection?.env).toEqual({ [MCP_TOKEN_ENV]: 'tok-abc' })
    expect(injection?.args).toEqual(['--approve-mcps'])
    const path = join(cwd, '.cursor', 'mcp.json')
    expect(readJson(path).mcpServers.project).toEqual({
      url: 'http://127.0.0.1:5123/mcp',
      headers: { Authorization: `Bearer \${env:${MCP_TOKEN_ENV}}` },
    })
    expect(readFileSync(path, 'utf8')).not.toContain('tok-abc')
  })
})
