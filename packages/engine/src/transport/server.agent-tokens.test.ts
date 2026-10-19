import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { createApp } from './server.js'
import { EventBus } from './events.js'
import { AgentTokenRegistry } from './agent-tokens.js'
import { Executor } from '../execution/executor.js'
import { HEADLESS_AGENT_TARGET_SOURCE } from '../mcp/toolset.js'

const TOKEN = 'master-token-master-token-master-tok'

let dir: string
let project: Project
let app: ReturnType<typeof createApp>
let agentTokens: AgentTokenRegistry
let now: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-agent-tokens-'))
  project = createProject(dir, { name: 'test' })
  now = 1_000_000
  agentTokens = new AgentTokenRegistry(() => now)
  const bus = new EventBus()
  const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
  app = createApp({ project, token: TOKEN, bus, registry, executor: new Executor(project, bus), agentTokens })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const body = res.status === 200 ? ((await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } }) : undefined
  return { status: res.status, result: body?.result }
}

describe('a headless agent token', () => {
  it('cannot call run_command, and the command never runs', async () => {
    const { token } = agentTokens.issue({ profile: 'workflow' })
    const marker = join(dir, 'pwned')
    const { status, result } = await callTool(token, 'run_command', { command: `touch ${marker}` })
    expect(status).toBe(200)
    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toMatch(/not available/)
    expect(existsSync(marker)).toBe(false)
  })

  it('cannot call run_workflow', async () => {
    const { token } = agentTokens.issue({ profile: 'scope' })
    const { result } = await callTool(token, 'run_workflow', { workflowId: 'w', targetId: 't' })
    expect(result?.content[0]?.text).toMatch(/not available/)
  })

  it('does not see dangerous tools in tools/list', async () => {
    const { token } = agentTokens.issue({ profile: 'workflow' })
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    const names = ((await res.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)
    expect(names).toContain('set_node_output')
    expect(names).not.toContain('run_command')
    expect(names).not.toContain('run_workflow')
  })

  it('can call the read and record tools of its profile', async () => {
    const { token } = agentTokens.issue({ profile: 'workflow' })
    expect((await callTool(token, 'list_targets', {})).result?.isError).toBeUndefined()
    expect((await callTool(token, 'add_finding', { severity: 'low', title: 'seen' })).result?.isError).toBeUndefined()
    // set_node_output is in the profile, but with no agent node bound to this
    // token's session there is nothing for it to write into.
    expect((await callTool(token, 'set_node_output', { data: { ok: true } })).result?.content[0]?.text).toMatch(/only accepted/)
  })

  it.each([
    ['GET', '/api/targets'],
    ['GET', '/api/secrets'],
    ['POST', '/api/terminals'],
    ['GET', '/api/files/read?path=x'],
  ])('is refused on %s %s', async (method, path) => {
    const { token } = agentTokens.issue({ profile: 'workflow' })
    const res = await app.request(path, { method, headers: bearer(token), ...(method === 'POST' ? { body: '{}' } : {}) })
    expect(res.status).toBe(403)
  })
})

describe('an interactive agent token', () => {
  it('can still call run_command', async () => {
    const { token } = agentTokens.issue({ profile: 'interactive', sessionId: 'term-1' })
    const { result } = await callTool(token, 'run_command', { command: 'printf scoped' })
    expect(result?.isError).toBeUndefined()
    expect(JSON.parse(result?.content[0]?.text ?? '{}')).toMatchObject({ stdout: 'scoped', exit_code: 0 })
  })

  it('is still confined to the agent routes of the HTTP API', async () => {
    const { token } = agentTokens.issue({ profile: 'interactive', sessionId: 'term-1' })
    expect((await app.request('/api/secrets', { headers: bearer(token) })).status).toBe(403)
    const res = await app.request('/api/terminals', { method: 'POST', headers: bearer(token), body: '{"kind":"shell"}' })
    expect(res.status).toBe(403)
  })

  it('posts hook events for its own session only', async () => {
    const { token } = agentTokens.issue({ profile: 'interactive', sessionId: 'term-1' })
    const post = (sessionId: string) =>
      app.request('/api/agent-events', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ sessionId, event: 'Stop', payload: {} }),
      })
    expect((await post('term-1')).status).toBe(200)
    expect((await post('term-2')).status).toBe(403)
  })
})

describe('a scoped token that is no longer valid', () => {
  it('is rejected once revoked', async () => {
    const issued = agentTokens.issue({ profile: 'interactive', sessionId: 'term-1' })
    expect((await callTool(issued.token, 'list_targets', {})).status).toBe(200)
    issued.revoke()
    expect((await callTool(issued.token, 'list_targets', {})).status).toBe(401)
    const res = await app.request('/api/agent-events', {
      method: 'POST',
      headers: bearer(issued.token),
      body: JSON.stringify({ sessionId: 'term-1', event: 'Stop' }),
    })
    expect(res.status).toBe(401)
  })

  it('is rejected once expired', async () => {
    const { token } = agentTokens.issue({ profile: 'workflow', ttlMs: 60_000 })
    expect((await callTool(token, 'list_targets', {})).status).toBe(200)
    now += 60_000
    expect((await callTool(token, 'list_targets', {})).status).toBe(401)
  })
})

describe('the master token', () => {
  it('still reaches every tool and every route', async () => {
    const { result } = await callTool(TOKEN, 'run_command', { command: 'printf master' })
    expect(JSON.parse(result?.content[0]?.text ?? '{}')).toMatchObject({ stdout: 'master' })
    expect((await app.request('/api/targets', { headers: bearer(TOKEN) })).status).toBe(200)
  })
})

describe('on_create schedules and agent-created targets', () => {
  beforeEach(() => {
    project.workflows.create('wf', JSON.stringify({ nodes: [], edges: [] }), { id: 'wf-1' })
    project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
  })

  it.each(['workflow', 'scope'] as const)('do not fire for a target a headless %s session creates', async (profile) => {
    const fired = vi.spyOn(app.scheduler, 'onTargetCreated')
    const { token } = agentTokens.issue({ profile, sessionId: 'headless-1' })
    const { result } = await callTool(token, 'upsert_target', { kind: 'domain', value: 'attacker-chosen.example' })
    expect(result?.isError).toBeUndefined()
    expect(fired).not.toHaveBeenCalled()
    // The target is still recorded, marked so the operator can tell where it came from.
    expect(project.targets.findByValue('domain', 'attacker-chosen.example')?.source).toBe(HEADLESS_AGENT_TARGET_SOURCE)
  })

  it('still fire for a target an interactive agent creates', async () => {
    const fired = vi.spyOn(app.scheduler, 'onTargetCreated').mockResolvedValue()
    const { token } = agentTokens.issue({ profile: 'interactive', sessionId: 'term-1' })
    await callTool(token, 'upsert_target', { kind: 'domain', value: 'operator.example' })
    expect(fired).toHaveBeenCalledTimes(1)
    expect(project.targets.findByValue('domain', 'operator.example')?.source).toBe('agent')
  })

  it('still fire for a target the user creates', async () => {
    const fired = vi.spyOn(app.scheduler, 'onTargetCreated').mockResolvedValue()
    const res = await app.request('/api/targets', {
      method: 'POST',
      headers: bearer(TOKEN),
      body: JSON.stringify({ kind: 'domain', value: 'user.example' }),
    })
    expect(res.status).toBeLessThan(300)
    expect(fired).toHaveBeenCalledTimes(1)
    expect(fired.mock.calls[0]?.[0]).toMatchObject({ value: 'user.example', source: 'manual' })
  })
})
