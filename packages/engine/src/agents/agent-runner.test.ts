import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PtyRegistry, type PtySessionOptions } from '@exe/pty'
import { createProject, type Project } from '@exe/project'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { AgentRunner } from './agent-runner.js'
import { ProjectToolset, type ToolsetDeps } from '../mcp/toolset.js'
import { mcpRoute } from '../mcp/route.js'
import { writeAgentMcpConfig } from '../mcp/agent-config.js'
import { AgentTokenRegistry } from '../transport/agent-tokens.js'
import { HeadlessCliRefused } from './headless-cli.js'

const TOKEN = 'agent-runner-token-agent-runner-tok'

let dir: string
let project: Project
let registry: PtyRegistry

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-agent-'))
  project = createProject(dir, { name: 'test' })
  registry = new PtyRegistry()
})

afterEach(() => {
  registry.killAll()
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('AgentRunner (auto mode)', () => {
  it('runs a fake agent, streams output, and captures the MCP node output', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))

    const toolsetDeps: ToolsetDeps = { project, runWorkflow: vi.fn() }
    const toolset = new ProjectToolset(toolsetDeps)
    const agentTokens = new AgentTokenRegistry()
    const app = mcpRoute(toolset, TOKEN, agentTokens)

    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(s))
    })

    try {
      const address = server.address() as AddressInfo
      const script = (configPath: string) => [
        'const fs = require("node:fs");',
        `const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, "utf8"));`,
        'const svc = cfg.mcpServers.project;',
        'fetch(svc.url, {',
        '  method: "POST",',
        '  headers: Object.assign({ "content-type": "application/json" }, svc.headers),',
        '  body: JSON.stringify({',
        '    jsonrpc: "2.0",',
        '    id: 1,',
        '    method: "tools/call",',
        '    params: { name: "set_node_output", arguments: { data: { hosts: ["a.com"] } } },',
        '  }),',
        '}).then(() => { process.stdout.write("mcp-called\\n"); process.exit(0); });',
      ].join('\n')

      const runner = new AgentRunner({
        bus,
        project,
        registry,
        toolsetDeps,
        // The run's token carries its session, as the engine issues it.
        buildArgv: ({ sessionId }) => {
          const { token } = agentTokens.issue({ profile: 'workflow', sessionId })
          return [process.execPath, '-e', script(writeAgentMcpConfig({ port: address.port, token }))]
        },
      })

      const result = await runner.runAuto({
        nodeId: 'agent-1',
        executionId: 'exec-1',
        prompt: 'enumerate hosts',
      })

      expect(result.parsed).toEqual([{ hosts: ['a.com'] }])
      expect(events.some((e) => e.type === 'stdout')).toBe(true)
      expect(events.filter((e) => e.type === 'status').map((e) => e.data)).toContain('succeeded')
    } finally {
      server.close()
    }
  }, 15000)

  it('errors the node when the agent produces neither MCP output nor parseable json', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))

    const toolsetDeps: ToolsetDeps = { project, runWorkflow: vi.fn() }

    const runner = new AgentRunner({
      bus,
      project,
      registry,
      toolsetDeps,
      buildArgv: () => [process.execPath, '-e', 'process.stdout.write("no json here")'],
    })

    const result = await runner.runAuto({ nodeId: 'agent-2', executionId: 'exec-2', prompt: 'x' })
    expect(result.parsed).toEqual([])
    expect(events.filter((e) => e.type === 'status').map((e) => e.data)).toContain('failed')
  }, 15000)

  it('falls back to extracting a fenced json block when the agent makes no MCP call', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))

    const toolsetDeps: ToolsetDeps = { project, runWorkflow: vi.fn() }

    const runner = new AgentRunner({
      bus,
      project,
      registry,
      toolsetDeps,
      buildArgv: () => [
        process.execPath,
        '-e',
        'process.stdout.write("working...\\n```json\\n{\\"hosts\\":[\\"a.com\\"]}\\n```\\n")',
      ],
    })

    const result = await runner.runAuto({ nodeId: 'agent-3', executionId: 'exec-3', prompt: 'x' })
    expect(result.parsed).toEqual([{ hosts: ['a.com'] }])
    expect(events.filter((e) => e.type === 'status').map((e) => e.data)).toContain('succeeded')
  }, 15000)
})

/** Records each spawn instead of starting a process; `exit()` ends one. */
class FakePty {
  readonly launches: Array<{ options: PtySessionOptions; exit(): void }> = []
  failNext = false

  create(_id: string, options: PtySessionOptions) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('spawn failed')
    }
    const exits: Array<(code: number) => void> = []
    this.launches.push({ options, exit: () => exits.forEach((fn) => fn(0)) })
    return { onData: () => {}, onExit: (fn: (code: number) => void) => void exits.push(fn), kill: () => {} }
  }
}

describe('AgentRunner session isolation', () => {
  async function setNodeOutput(app: ReturnType<typeof mcpRoute>, token: string, data: Record<string, unknown>) {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_node_output', arguments: { data } } }),
    })
    return ((await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } }).result
  }

  it('gives concurrent agent nodes their own output, and neither can write the other', async () => {
    const toolsetDeps: ToolsetDeps = { project, runWorkflow: vi.fn() }
    const agentTokens = new AgentTokenRegistry()
    const app = mcpRoute(new ProjectToolset(toolsetDeps), TOKEN, agentTokens)
    const pty = new FakePty()
    const tokens: string[] = []
    const runner = new AgentRunner({
      bus: new EventBus(),
      project,
      registry: pty as unknown as PtyRegistry,
      toolsetDeps,
      buildArgv: ({ sessionId, defer }) => {
        const issued = agentTokens.issue({ profile: 'workflow', sessionId })
        defer(issued.revoke)
        tokens.push(issued.token)
        return ['fake-agent']
      },
    })

    const a = runner.runAuto({ nodeId: 'a', executionId: 'exec-1', prompt: 'x' })
    const b = runner.runAuto({ nodeId: 'b', executionId: 'exec-1', prompt: 'y' })
    const [tokenA, tokenB] = tokens as [string, string]
    expect(toolsetDeps.sessions?.size).toBe(2)

    // B writes after A, so a shared slot would hand B's output to both nodes.
    expect((await setNodeOutput(app, tokenA, { from: 'a' })).isError).toBeUndefined()
    expect((await setNodeOutput(app, tokenB, { from: 'b' })).isError).toBeUndefined()

    // A workflow token for a session no node is waiting on reaches nothing,
    // and neither does the master token.
    const stray = agentTokens.issue({ profile: 'workflow', sessionId: 'not-a-running-node' })
    expect((await setNodeOutput(app, stray.token, { from: 'stray' })).content[0]?.text).toMatch(/only accepted/)
    expect((await setNodeOutput(app, TOKEN, { from: 'master' })).content[0]?.text).toMatch(/only accepted/)

    pty.launches[0]!.exit()
    expect((await a).parsed).toEqual([{ from: 'a' }])
    // A has exited: its token is revoked and its session unbound, so it can no
    // longer write anywhere, B included.
    expect(agentTokens.verify(tokenA)).toBeUndefined()
    expect((await app.request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${tokenA}` }, body: '{}' })).status).toBe(401)
    expect((await setNodeOutput(app, tokenB, { from: 'b2' })).isError).toBeUndefined()

    pty.launches[1]!.exit()
    expect((await b).parsed).toEqual([{ from: 'b2' }])
    expect(toolsetDeps.sessions?.size).toBe(0)
  })

  it('unbinds the session and revokes the token when the spawn throws', async () => {
    const toolsetDeps: ToolsetDeps = { project, runWorkflow: vi.fn() }
    const agentTokens = new AgentTokenRegistry()
    const pty = new FakePty()
    pty.failNext = true
    let token = ''
    const runner = new AgentRunner({
      bus: new EventBus(),
      project,
      registry: pty as unknown as PtyRegistry,
      toolsetDeps,
      buildArgv: ({ sessionId, defer }) => {
        const issued = agentTokens.issue({ profile: 'workflow', sessionId })
        defer(issued.revoke)
        token = issued.token
        return ['fake-agent']
      },
    })
    await expect(runner.runAuto({ nodeId: 'a', executionId: 'exec-1', prompt: 'x' })).rejects.toThrow(/spawn failed/)
    expect(agentTokens.verify(token)).toBeUndefined()
    expect(toolsetDeps.sessions?.size).toBe(0)
  })

  it('fails the node with the reason when its CLI is refused, without spawning', async () => {
    const bus = new EventBus()
    const events: EngineEvent[] = []
    bus.subscribe((e) => events.push(e))
    const pty = new FakePty()
    const runner = new AgentRunner({
      bus,
      project,
      registry: pty as unknown as PtyRegistry,
      toolsetDeps: { project, runWorkflow: vi.fn() },
      buildArgv: ({ allowUnrestrictedCli }) => {
        if (!allowUnrestrictedCli) throw new HeadlessCliRefused('cursor is refused here')
        return ['cursor-agent']
      },
    })
    const result = await runner.runAuto({ nodeId: 'a', executionId: 'exec-1', prompt: 'x', agent: 'cursor' })
    expect(result.parsed).toEqual([])
    expect(result.transcript).toContain('cursor is refused here')
    expect(pty.launches).toHaveLength(0)
    expect(events.find((e) => e.type === 'stderr')?.data).toContain('cursor is refused here')
    expect(events.filter((e) => e.type === 'status').map((e) => e.data)).toContain('failed')
  })
})
