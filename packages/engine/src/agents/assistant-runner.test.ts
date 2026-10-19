import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PtyRegistry } from '@exe/pty'
import { createProject, type Project } from '@exe/project'
import { AssistantRunner, parseClaudeJson } from './assistant-runner.js'
import { ProjectToolset, type ToolsetDeps } from '../mcp/toolset.js'
import { mcpRoute } from '../mcp/route.js'
import { writeAgentMcpConfig } from '../mcp/agent-config.js'
import { AgentTokenRegistry } from '../transport/agent-tokens.js'

const TOKEN = 'assistant-runner-token-assistant-run'

let dir: string
let project: Project
let registry: PtyRegistry

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-assistant-'))
  project = createProject(dir, { name: 'test' })
  registry = new PtyRegistry()
})

afterEach(() => {
  registry.killAll()
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('parseClaudeJson', () => {
  it('extracts reply and session id from Claude JSON output', () => {
    const out = JSON.stringify({ type: 'result', result: 'hello there', session_id: 'sess-abc' })
    expect(parseClaudeJson(out)).toEqual({ reply: 'hello there', sessionId: 'sess-abc' })
  })

  it('falls back to raw text when output is not JSON', () => {
    expect(parseClaudeJson('just text')).toEqual({ reply: 'just text' })
  })
})

describe('AssistantRunner', () => {
  it('runs a fake agent, captures a proposal via MCP, and parses reply + session', async () => {
    const toolsetDeps: ToolsetDeps = { project, runWorkflow: vi.fn() }
    const toolset = new ProjectToolset(toolsetDeps)
    const agentTokens = new AgentTokenRegistry()
    const app = mcpRoute(toolset, TOKEN, agentTokens)

    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(s))
    })

    try {
      const address = server.address() as AddressInfo

      // The fake agent calls propose_workflow through MCP, then prints a
      // Claude-style JSON result carrying the reply and a session id.
      const script = (configPath: string) => [
        'const fs = require("node:fs");',
        `const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, "utf8"));`,
        'const svc = cfg.mcpServers.project;',
        'const graph = { nodes: [{ id: "m", type: "manual", data: {} }], edges: [] };',
        'fetch(svc.url, {',
        '  method: "POST",',
        '  headers: Object.assign({ "content-type": "application/json" }, svc.headers),',
        '  body: JSON.stringify({',
        '    jsonrpc: "2.0", id: 1, method: "tools/call",',
        '    params: { name: "propose_workflow", arguments: { name: "WF", graph, summary: "one node" } },',
        '  }),',
        '}).then(() => {',
        '  process.stdout.write(JSON.stringify({ type: "result", result: "Built it", session_id: "sess-9" }));',
        '  process.exit(0);',
        '});',
      ].join('\n')

      const runner = new AssistantRunner({
        registry,
        toolsetDeps,
        cwd: dir,
        // The turn's token carries its session, as the engine issues it.
        buildArgv: ({ sessionId }) => {
          const { token } = agentTokens.issue({ profile: 'assistant', sessionId })
          return [process.execPath, '-e', script(writeAgentMcpConfig({ port: address.port, token }))]
        },
      })

      const result = await runner.run({ prompt: 'build a workflow', agent: 'claude' })

      expect(result.reply).toBe('Built it')
      expect(result.sessionId).toBe('sess-9')
      expect(result.proposal).toMatchObject({ name: 'WF', summary: 'one node' })
      // The turn's session is unbound after the run.
      expect(toolsetDeps.sessions?.size).toBe(0)
    } finally {
      server.close()
    }
  }, 15000)

  it('passes the prior session id to buildArgv as resume', async () => {
    const toolsetDeps: ToolsetDeps = { project, runWorkflow: vi.fn() }
    const buildArgv = vi.fn(() => [process.execPath, '-e', 'process.stdout.write("{}")'])
    const runner = new AssistantRunner({ registry, toolsetDeps, cwd: dir, buildArgv })
    await runner.run({ prompt: 'again', agent: 'claude', sessionId: 'sess-prev' })
    expect(buildArgv).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'again', agent: 'claude', resume: 'sess-prev' }))
  }, 15000)
})
