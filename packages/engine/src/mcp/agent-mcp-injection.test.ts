import { describe, expect, it } from 'vitest'
import {
  MCP_INJECTABLE_AGENTS,
  buildAgentMcpInjection,
  isMcpInjectableAgent,
} from './agent-mcp-injection.js'
import { OPENCODE_HEADLESS_AGENT } from '../agents/headless-cli.js'

describe('isMcpInjectableAgent', () => {
  it('is true for agents this module can inject, false otherwise', () => {
    expect(isMcpInjectableAgent('opencode')).toBe(true)
    // claude has its own path; codex/gemini/cursor/hermes are not wired yet.
    expect(isMcpInjectableAgent('claude')).toBe(false)
    expect(isMcpInjectableAgent('codex')).toBe(false)
  })

  it('every listed injectable agent actually yields an injection when given an MCP endpoint', () => {
    for (const agent of MCP_INJECTABLE_AGENTS) {
      expect(buildAgentMcpInjection(agent, { mcp: { port: 1, token: 't' } })).toBeDefined()
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
    expect(buildAgentMcpInjection('gemini', { mcp: { port: 1, token: 't' } })).toBeUndefined()
  })
})
