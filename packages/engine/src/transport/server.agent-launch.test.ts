import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import type { PtyRegistry, PtySessionOptions } from '@exe/pty'
import { createApp } from './server.js'
import { EventBus } from './events.js'
import { AgentTokenRegistry } from './agent-tokens.js'
import { Executor } from '../execution/executor.js'
import { PROFILE_TOOLS } from '../mcp/toolset.js'
import { OPENCODE_HEADLESS_AGENT } from '../agents/headless-cli.js'

const TOKEN = 'master-token-master-token-master-tok'

interface Launch {
  options: PtySessionOptions
  exit(): void
}

/** Records every spawn instead of starting a process; `exit()` ends one. */
class FakePty {
  readonly launches: Launch[] = []
  /** Set to make the next spawn throw, as a missing binary does. */
  failNext = false
  private taken = 0
  /** Callers of next() waiting for a launch that has not happened yet. */
  private waiting: Array<() => void> = []

  create(_id: string, options: PtySessionOptions) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('spawn failed')
    }
    const exits: Array<(code: number) => void> = []
    this.launches.push({ options, exit: () => exits.forEach((fn) => fn(0)) })
    const wake = this.waiting
    this.waiting = []
    wake.forEach((fn) => fn())
    return {
      onData: () => {},
      onExit: (fn: (code: number) => void) => void exits.push(fn),
      kill: () => {},
    }
  }

  /** Resolves with the next launch not yet taken, waiting for it to be spawned. */
  async next(): Promise<Launch> {
    // Woken by create() itself, so a slow, loaded run cannot outlast a polling
    // budget; a launch that never comes fails as the test's timeout.
    while (this.launches.length <= this.taken) await new Promise<void>((resolve) => this.waiting.push(resolve))
    const launch = this.launches[this.taken] as Launch
    this.taken += 1
    return launch
  }
}

let dir: string
let project: Project
let pty: FakePty
let agentTokens: AgentTokenRegistry
let app: ReturnType<typeof createApp>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-agent-launch-'))
  project = createProject(dir, { name: 'test' })
  pty = new FakePty()
  agentTokens = new AgentTokenRegistry()
  const bus = new EventBus()
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  app = createApp({
    project,
    token: TOKEN,
    bus,
    registry,
    executor: new Executor(project, bus),
    ptyRegistry: pty as unknown as PtyRegistry,
    connection: { port: 4100, token: TOKEN },
    agentTokens,
  })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

function argsOf(launch: Launch): string[] {
  return launch.options.args ?? []
}

/** The bearer token in the MCP config a claude launch points at. */
function claudeMcpToken(launch: Launch): { token: string; configPath: string } {
  const args = argsOf(launch)
  const configPath = args[args.indexOf('--mcp-config') + 1] ?? ''
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    mcpServers: { project: { headers: { Authorization: string } } }
  }
  return { token: config.mcpServers.project.headers.Authorization.replace(/^Bearer /, ''), configPath }
}

/** The values that follow `--allowedTools`, up to the next flag. */
function allowedTools(launch: Launch): string[] {
  const args = argsOf(launch)
  const start = args.indexOf('--allowedTools')
  if (start === -1) return []
  const rest = args.slice(start + 1)
  const end = rest.findIndex((a) => a.startsWith('--'))
  return end === -1 ? rest : rest.slice(0, end)
}

function expectRestricted(launch: Launch, profile: 'workflow' | 'assistant' | 'scope'): void {
  const allowed = allowedTools(launch)
  expect(allowed).toEqual(PROFILE_TOOLS[profile].map((t) => `mcp__project__${t}`))
  expect(allowed).not.toContain('mcp__project')
  expect(allowed).not.toContain('mcp__project__run_command')
  expect(allowed).not.toContain('mcp__project__run_workflow')
}

describe('headless agent launches', () => {
  it('give a workflow agent node only the workflow tools and a scoped token revoked on exit', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = { nodes: [{ id: 'a', type: 'agent', data: { agent: 'claude', prompt: 'look at {{ target.value }}' } }], edges: [] }
    project.workflows.create('wf', JSON.stringify(graph), { id: 'wf-agent' })
    const run = app.request('/api/workflows/wf-agent/run', { method: 'POST', headers, body: JSON.stringify({ targetId: target.id }) })

    const launch = await pty.next()
    expect(argsOf(launch).slice(0, 1)).toEqual(['-p'])
    expectRestricted(launch, 'workflow')
    const { token, configPath } = claudeMcpToken(launch)
    expect(token).not.toBe(TOKEN)
    expect(agentTokens.verify(token)?.profile).toBe('workflow')
    expect(agentTokens.verify(token)?.expiresAt).toBeDefined()

    launch.exit()
    await run
    expect(agentTokens.verify(token)).toBeUndefined()
    expect(existsSync(dirname(configPath))).toBe(false)
  })

  it('give a headless opencode agent node the same allow-list through its config', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = { nodes: [{ id: 'a', type: 'agent', data: { agent: 'opencode', prompt: 'x' } }], edges: [] }
    project.workflows.create('wf', JSON.stringify(graph), { id: 'wf-oc' })
    const run = app.request('/api/workflows/wf-oc/run', { method: 'POST', headers, body: JSON.stringify({ targetId: target.id }) })

    const launch = await pty.next()
    expect(launch.options.command).toBe('opencode')
    expect(argsOf(launch).slice(0, 3)).toEqual(['run', '--agent', OPENCODE_HEADLESS_AGENT])
    const config = JSON.parse(launch.options.env?.OPENCODE_CONFIG_CONTENT ?? '{}') as {
      mcp: { project: { headers: { Authorization: string } } }
      permission: Record<string, string>
      agent: Record<string, { permission: Record<string, unknown> }>
    }
    expect(config.permission).toEqual({ '*': 'deny' })
    const rules = config.agent[OPENCODE_HEADLESS_AGENT]?.permission ?? {}
    expect(rules['*']).toBe('deny')
    expect(Object.keys(rules).filter((k) => k.startsWith('project_')).sort()).toEqual(
      PROFILE_TOOLS.workflow.map((t) => `project_${t}`).sort(),
    )
    const token = config.mcp.project.headers.Authorization.replace(/^Bearer /, '')
    expect(agentTokens.verify(token)?.profile).toBe('workflow')
    // Its briefing lists the workflow tools only, never run_command.
    const { instructions } = JSON.parse(launch.options.env?.OPENCODE_CONFIG_CONTENT ?? '{}') as { instructions: string[] }
    const briefing = readFileSync(instructions[0] ?? '', 'utf8')
    expect(briefing).toContain('set_node_output')
    expect(briefing).not.toContain('run_command')
    expect(briefing).not.toContain('run_workflow')

    launch.exit()
    await run
    expect(agentTokens.verify(token)).toBeUndefined()
  })

  it('give a headless codex agent node a read-only sandbox and no shell tool', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = { nodes: [{ id: 'a', type: 'agent', data: { agent: 'codex', prompt: 'x' } }], edges: [] }
    project.workflows.create('wf', JSON.stringify(graph), { id: 'wf-cx' })
    const run = app.request('/api/workflows/wf-cx/run', { method: 'POST', headers, body: JSON.stringify({ targetId: target.id }) })

    const launch = await pty.next()
    expect(launch.options.command).toBe('codex')
    const args = argsOf(launch)
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
    expect(args.some((a, i) => a === '--disable' && args[i + 1] === 'shell_tool')).toBe(true)
    expect(args).toContain('--ignore-user-config')
    launch.exit()
    await run
  })

  it.each(['cursor', 'hermes'])('refuse a headless %s agent node that has not opted in, without launching it', async (agent) => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = { nodes: [{ id: 'a', type: 'agent', data: { agent, prompt: 'x' } }], edges: [] }
    project.workflows.create('wf', JSON.stringify(graph), { id: `wf-${agent}` })
    const res = await app.request(`/api/workflows/wf-${agent}/run`, { method: 'POST', headers, body: JSON.stringify({ targetId: target.id }) })
    expect(res.status).toBeLessThan(500)
    expect(pty.launches).toHaveLength(0)
    expect(agentTokens.size).toBe(0)
  })

  it('launch an opted-in cursor agent node with its deny-all permissions', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = {
      nodes: [{ id: 'a', type: 'agent', data: { agent: 'cursor', prompt: 'x', allow_unrestricted_cli: true } }],
      edges: [],
    }
    project.workflows.create('wf', JSON.stringify(graph), { id: 'wf-cur' })
    const run = app.request('/api/workflows/wf-cur/run', { method: 'POST', headers, body: JSON.stringify({ targetId: target.id }) })
    const launch = await pty.next()
    expect(launch.options.command).toBe('cursor-agent')
    expect(argsOf(launch)).not.toContain('--force')
    expect(launch.options.env?.CURSOR_CONFIG_DIR).toBeDefined()
    launch.exit()
    await run
  })

  it('give the scope parser only the scope tools, with hooks on the same scoped token', async () => {
    const res = await app.request('/api/scope/parse', { method: 'POST', headers, body: JSON.stringify({ scope: 'example.com' }) })
    expect(res.status).toBe(202)
    const launch = await pty.next()
    expectRestricted(launch, 'scope')
    const { token } = claudeMcpToken(launch)
    const args = argsOf(launch)
    const settingsDir = dirname(args[args.indexOf('--settings') + 1] ?? '')
    expect(readFileSync(join(settingsDir, 'token'), 'utf8')).toBe(token)
    expect(readFileSync(join(settingsDir, 'settings.json'), 'utf8')).not.toContain(token)
    expect(agentTokens.verify(token)?.profile).toBe('scope')

    launch.exit()
    expect(agentTokens.verify(token)).toBeUndefined()
    expect(existsSync(settingsDir)).toBe(false)
  })

  it('give the workflow assistant only the assistant tools', async () => {
    const convo = (await (await app.request('/api/assistant/conversation?workflowId=w1', { headers })).json()) as {
      conversation: { id: string }
    }
    const reply = app.request(`/api/assistant/conversation/${convo.conversation.id}/message`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hello', graph: { nodes: [], edges: [] } }),
    })
    const launch = await pty.next()
    expectRestricted(launch, 'assistant')
    const { token } = claudeMcpToken(launch)
    expect(agentTokens.verify(token)?.profile).toBe('assistant')

    launch.exit()
    await reply
    expect(agentTokens.verify(token)).toBeUndefined()
  })
})

describe('interactive agent launches', () => {
  it('give a claude terminal the full toolset on a scoped token that ends with the terminal', async () => {
    const res = await app.request('/api/terminals', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent', agent: 'claude' }) })
    const { id } = (await res.json()) as { id: string }
    const launch = await pty.next()
    expect(allowedTools(launch)).toEqual([])
    expect(argsOf(launch).join(' ')).not.toContain(TOKEN)
    const { token, configPath } = claudeMcpToken(launch)
    expect(token).not.toBe(TOKEN)
    const grant = agentTokens.verify(token)
    expect(grant).toMatchObject({ profile: 'interactive', sessionId: id })
    expect(grant?.tools.has('run_command')).toBe(true)
    expect(grant?.expiresAt).toBeUndefined()

    launch.exit()
    expect(agentTokens.verify(token)).toBeUndefined()
    expect(existsSync(configPath)).toBe(false)
  })

  it('give an opencode terminal the full toolset with no tool or permission overrides', async () => {
    await app.request('/api/terminals', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent', agent: 'opencode' }) })
    const launch = await pty.next()
    const config = JSON.parse(launch.options.env?.OPENCODE_CONFIG_CONTENT ?? '{}') as Record<string, unknown> & {
      mcp: { project: { headers: { Authorization: string } } }
    }
    expect(config).not.toHaveProperty('tools')
    expect(config).not.toHaveProperty('permission')
    const token = config.mcp.project.headers.Authorization.replace(/^Bearer /, '')
    expect(agentTokens.verify(token)?.profile).toBe('interactive')

    launch.exit()
    expect(agentTokens.verify(token)).toBeUndefined()
  })
})

describe('an interactive launch that fails', () => {
  it.each(['claude', 'opencode'])('revokes the %s terminal token when the spawn throws', async (agent) => {
    pty.failNext = true
    const res = await app.request('/api/terminals', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent', agent }) })
    expect(res.status).toBe(500)
    expect(pty.launches).toHaveLength(0)
    expect(agentTokens.size).toBe(0)
  })

  it('revokes the token when the launch throws after issuing it but before the spawn', async () => {
    // Reading the team roster happens after the token and its config exist.
    vi.spyOn(project.savedAgents, 'list').mockImplementation(() => {
      throw new Error('roster unavailable')
    })
    const res = await app.request('/api/terminals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'agent', agent: 'claude-team' }),
    })
    expect(res.status).toBe(500)
    expect(pty.launches).toHaveLength(0)
    expect(agentTokens.size).toBe(0)
  })

  it('leaves a terminal that did spawn with a live token', async () => {
    await app.request('/api/terminals', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent', agent: 'claude' }) })
    await pty.next()
    expect(agentTokens.size).toBe(1)
  })
})
