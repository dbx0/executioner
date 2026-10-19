import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAllowedTools, writeAgentBriefingFile, writeAgentMcpConfig } from './agent-config.js'

describe('writeAgentMcpConfig', () => {
  it('writes a config pointing at the loopback mcp url with the token', () => {
    const path = writeAgentMcpConfig({ port: 5000, token: 'abc' })
    const config = JSON.parse(readFileSync(path, 'utf8')) as {
      mcpServers: { project: { url: string; type: string; headers: { Authorization: string } } }
    }
    const server = config.mcpServers.project
    expect(server.url).toBe('http://127.0.0.1:5000/mcp')
    expect(server.headers.Authorization).toBe('Bearer abc')
    expect(server.type).toBe('http')
    rmSync(path)
  })
})

describe('claudeAllowedTools', () => {
  it('names each headless tool and never the whole server or a dangerous tool', () => {
    for (const profile of ['workflow', 'assistant', 'scope'] as const) {
      const allowed = claudeAllowedTools(profile)
      expect(allowed.every((t) => t.startsWith('mcp__project__'))).toBe(true)
      expect(allowed).not.toContain('mcp__project')
      expect(allowed).not.toContain('mcp__project__run_command')
      expect(allowed).not.toContain('mcp__project__run_workflow')
    }
    expect(claudeAllowedTools('workflow')).toContain('mcp__project__set_node_output')
    expect(claudeAllowedTools('assistant')).toContain('mcp__project__propose_workflow')
    expect(claudeAllowedTools('scope')).toContain('mcp__project__add_scope_rule')
  })
})

describe('writeAgentBriefingFile', () => {
  it('writes the briefing into <root>/.executioner/agent-briefing.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'exe-briefroot-'))
    const path = writeAgentBriefingFile('Engagement: acme\nDo the thing.', root)
    expect(path).toBe(join(root, '.executioner', 'agent-briefing.md'))
    expect(readFileSync(path, 'utf8')).toBe('Engagement: acme\nDo the thing.')
    rmSync(root, { recursive: true, force: true })
  })

  it('overwrites the same stable file each launch (no accumulation)', () => {
    const root = mkdtempSync(join(tmpdir(), 'exe-briefroot-'))
    const first = writeAgentBriefingFile('one', root)
    const second = writeAgentBriefingFile('two', root)
    expect(second).toBe(first)
    expect(readFileSync(first, 'utf8')).toBe('two')
    rmSync(root, { recursive: true, force: true })
  })

  it('gives a headless profile its own file so it never overwrites a terminal briefing', () => {
    const root = mkdtempSync(join(tmpdir(), 'exe-briefroot-'))
    const interactive = writeAgentBriefingFile('all tools', root)
    const workflow = writeAgentBriefingFile('workflow tools', root, 'workflow')
    expect(workflow).toBe(join(root, '.executioner', 'agent-briefing.workflow.md'))
    expect(readFileSync(interactive, 'utf8')).toBe('all tools')
    rmSync(root, { recursive: true, force: true })
  })
})
