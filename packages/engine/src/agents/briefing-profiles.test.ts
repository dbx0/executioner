import { describe, expect, it } from 'vitest'
import type { Project } from '@exe/project'
import { buildProjectBriefing } from './project-briefing.js'
import { buildScopePrompt } from './agent-scope-runner.js'
import { PROFILE_TOOLS, TOOL_ACCESS, type AgentProfile, type ToolName } from '../mcp/toolset.js'

/** Every project tool a text names, bare or with an `mcp__project__` prefix. */
function mentionedTools(text: string): ToolName[] {
  return (Object.keys(TOOL_ACCESS) as ToolName[]).filter((tool) => new RegExp(`(?<![a-z0-9])${tool}(?![a-z0-9_])`).test(text))
}

function projectStub(): Project {
  return {
    root: '/tmp/acme',
    config: { name: 'Acme', defaultBackend: 'local', createdAt: '2026-01-01T00:00:00.000Z' },
    backends: { list: () => [{ id: 'b1', name: 'Kali', kind: 'ssh', host: 'h', user: 'u' }] },
    targets: { all: () => Array.from({ length: 30 }, (_, i) => ({ kind: 'subdomain', value: `h${i}.acme.com` })) },
    findings: { list: () => [{ severity: 'high' }] },
  } as unknown as Project
}

describe('the briefing for each profile', () => {
  it.each<AgentProfile>(['interactive', 'workflow', 'assistant', 'scope'])(
    'names exactly the %s profile tools',
    (profile) => {
      const text = buildProjectBriefing(projectStub(), '/tmp/memory', { profile })
      expect(mentionedTools(text).sort()).toEqual([...PROFILE_TOOLS[profile]].sort())
    },
  )

  it.each<AgentProfile>(['workflow', 'assistant', 'scope'])(
    'never offers the headless %s profile a backend to run commands on',
    (profile) => {
      const text = buildProjectBriefing(projectStub(), '/tmp/memory', { profile })
      expect(text).not.toContain('Execution backends')
      expect(text).toContain('You cannot run commands or workflows')
      // Headless runs cannot edit files, so they are not asked to write memory.
      expect(text).not.toContain('Worth recording')
    },
  )

  it('still gives an interactive agent the backends and the memory guidance', () => {
    const text = buildProjectBriefing(projectStub(), '/tmp/memory')
    expect(text).toContain('Execution backends')
    expect(text).toContain('Worth recording')
    expect(text).not.toContain('You cannot run commands')
  })

  it('names no tool at all without the MCP toolset', () => {
    expect(mentionedTools(buildProjectBriefing(projectStub(), '/tmp/memory', { mcp: false }))).toEqual([])
  })
})

describe('the scope parser prompt', () => {
  it('only names tools of the scope profile', () => {
    for (const tool of mentionedTools(buildScopePrompt('example.com', 'notes'))) {
      expect(PROFILE_TOOLS.scope).toContain(tool)
    }
  })
})
