import { mkdtempSync, rmSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { HEADLESS_AGENT_TARGET_SOURCE, ProjectToolset } from './toolset.js'
import { AgentSessionSinks } from './agent-sessions.js'
import type { CommandLauncher } from '../infra/launcher.js'
import type { LaunchSpec } from '../infra/launcher.js'

/** A fake child process that emits scripted output then closes. */
function fakeLauncher(script: {
  stdout?: string
  stderr?: string
  code?: number
  onLaunch?: (spec: LaunchSpec) => void
}): CommandLauncher {
  return {
    kind: 'local',
    launch(spec: LaunchSpec) {
      script.onLaunch?.(spec)
      const child = new EventEmitter() as unknown as {
        stdout: PassThrough
        stderr: PassThrough
        kill: () => void
      } & EventEmitter
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => {}
      setImmediate(() => {
        if (script.stdout !== undefined) child.stdout.emit('data', Buffer.from(script.stdout))
        if (script.stderr !== undefined) child.stderr.emit('data', Buffer.from(script.stderr))
        child.emit('close', script.code ?? 0)
      })
      return child as never
    },
  }
}

let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-toolset-'))
  project = createProject(dir, { name: 'test' })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ProjectToolset', () => {
  it('lists executions and inspects the last one for diagnosis', async () => {
    const store = project.runs
    const exec = store.createExecution({ workflowId: null, targetId: null, backend: 'local', testMode: false })
    store.recordNode({
      executionId: exec.id,
      nodeId: 'nmap-1',
      status: 'failed',
      exitCode: 1,
      stdoutPath: null,
      stderrPath: null,
      parsedOutput: null,
    })
    store.finishExecution(exec.id, 'failed', 'boom')
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), executionStore: store })

    const list = (await toolset.call('list_executions', {})) as Array<{ id: string; status: string }>
    expect(list[0]!.id).toBe(exec.id)
    expect(list[0]!.status).toBe('failed')

    // No id -> most recent execution, with per-node status.
    const got = (await toolset.call('get_execution', {})) as { id: string; nodes: Array<{ nodeId: string; status: string; exitCode: number | null }> }
    expect(got.id).toBe(exec.id)
    expect(got.nodes).toEqual([{ nodeId: 'nmap-1', status: 'failed', exitCode: 1, stdout: '', stderr: '' }])
  })


  it('lists backends so run_command\'s backend id is discoverable', async () => {
    // run_command takes a backend id but, without this, nothing told an agent
    // which ids exist — so remote tooling was unreachable in practice.
    project.backends.create({ kind: 'ssh', name: 'Kali', host: '10.0.0.5', user: 'root', workdir: '/opt' })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })

    const list = (await toolset.call('list_backends', {})) as Array<Record<string, unknown>>

    // `local` is always offered: it is what run_command uses by default.
    expect(list[0]).toMatchObject({ id: 'local', kind: 'local' })
    expect(list[1]).toMatchObject({ id: expect.any(String), name: 'Kali', kind: 'ssh', host: '10.0.0.5', user: 'root', workdir: '/opt' })
    // The id must be usable verbatim as run_command's `backend`.
    expect(project.backends.get(list[1]!.id as string)).toBeDefined()
  })

  it('reports backend env by key only, never its values', async () => {
    project.backends.create({ kind: 'ssh', name: 'Kali', host: 'h', user: 'u', env: { AWS_SECRET_ACCESS_KEY: 'hunter2' } })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })

    const list = (await toolset.call('list_backends', {})) as Array<Record<string, unknown>>

    expect(list[1]!.envKeys).toEqual(['AWS_SECRET_ACCESS_KEY'])
    expect(JSON.stringify(list)).not.toContain('hunter2')
  })

  it('lists targets', async () => {
    project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    const result = await toolset.call('list_targets', {})
    expect(result).toEqual([{ id: expect.any(String), kind: 'domain', value: 'a.com', source: 'manual' }])
  })

  it('upserts a target', async () => {
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    await toolset.call('upsert_target', { kind: 'subdomain', value: 'api.a.com' })
    expect(project.targets.findByValue('subdomain', 'api.a.com')).not.toBeUndefined()
  })

  it('does not nest a target under a parent with the same value', async () => {
    project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    // An agent adding the apex as a subdomain of itself must stay a root.
    await toolset.call('upsert_target', { kind: 'subdomain', value: 'a.com', parent: 'a.com' })
    expect(project.targets.findByValue('subdomain', 'a.com')?.parentId ?? null).toBeNull()
  })

  it('adds a finding against a target found by value', async () => {
    const t = project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    await toolset.call('add_finding', { target: 'a.com', severity: 'high', title: 'exposed .git' })
    expect(project.findings.forTarget(t.id)).toHaveLength(1)
  })

  it('runs a workflow via the injected executor', async () => {
    const runWorkflow = vi.fn(async () => ({ executionId: 'exec-9', status: 'success' as const }))
    const toolset = new ProjectToolset({ project, runWorkflow })
    const t = project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    const result = await toolset.call('run_workflow', { workflowId: 'wf1', targetId: t.id })
    expect(runWorkflow).toHaveBeenCalledWith('wf1', t.id)
    expect(result).toMatchObject({ executionId: 'exec-9', status: 'success' })
  })

  it('reads a target with its facts', async () => {
    const t = project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    project.facts.record({ targetId: t.id, kind: 'port', executionId: null, nodeId: null, data: { port: 443 } })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    const result = (await toolset.call('get_target', { value: 'a.com' })) as { facts: unknown[] }
    expect(result.facts).toHaveLength(1)
  })

  it('throws for an unknown tool', async () => {
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    await expect(toolset.call('drop_database', {})).rejects.toThrow(/unknown tool/)
  })

  it('validates arguments and rejects a malformed call', async () => {
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    await expect(toolset.call('upsert_target', { kind: 'planet', value: 'x' })).rejects.toThrow()
  })

  it('lists node types including built-ins and provided manifests', async () => {
    const manifests = () => [
      {
        id: 'httpx',
        name: 'httpx',
        description: 'probe',
        category: 'recon',
        accepts: ['domain' as const],
        params: { threads: { type: 'number' as const, default: 50 } },
        command: { program: 'httpx', args: [], timeout_ms: 120000 },
        emit: { parser: 'json' as const, source: 'stdout' as const, records: '$', targets: [], facts: [] },
      },
    ]
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), manifests })
    const types = (await toolset.call('list_node_types', {})) as Array<{ type: string; kind: string; params: unknown[] }>
    expect(types.some((t) => t.type === 'agent' && t.kind === 'agent')).toBe(true)
    expect(types.some((t) => t.type === 'if')).toBe(true)
    const httpx = types.find((t) => t.type === 'httpx')
    expect(httpx?.kind).toBe('tool')
    expect(httpx?.params).toEqual([{ name: 'threads', type: 'number', default: 50 }])
  })

  it('returns the live assistant graph to the session it is bound to only', async () => {
    const assistantGraph = { nodes: [{ id: 'n1', type: 'manual', data: {} }], edges: [] }
    const sessions = new AgentSessionSinks()
    sessions.bind('turn-1', { graph: assistantGraph })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), sessions })
    expect(await toolset.call('get_workflow_graph', {}, { profile: 'assistant', sessionId: 'turn-1' })).toEqual(assistantGraph)
    expect(await toolset.call('get_workflow_graph', {}, { profile: 'assistant', sessionId: 'turn-2' })).toEqual({ nodes: [], edges: [] })
    expect(await toolset.call('get_workflow_graph', {})).toEqual({ nodes: [], edges: [] })
  })

  it('captures a valid proposal for the session that made it', async () => {
    let captured: unknown
    const sessions = new AgentSessionSinks()
    sessions.bind('turn-1', {
      proposal: (p) => {
        captured = p
      },
    })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), sessions })
    const graph = { nodes: [{ id: 'a', type: 'manual', data: {} }], edges: [] }
    const result = await toolset.call(
      'propose_workflow',
      { name: 'Recon', graph, summary: 'one node' },
      { profile: 'assistant', sessionId: 'turn-1' },
    )
    expect(result).toEqual({ ok: true })
    expect(captured).toMatchObject({ name: 'Recon', summary: 'one node' })
  })

  it('refuses a proposal from a session no assistant turn is bound to', async () => {
    const sink = vi.fn()
    const sessions = new AgentSessionSinks()
    sessions.bind('turn-1', { proposal: sink })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), sessions })
    const graph = { nodes: [{ id: 'a', type: 'manual', data: {} }], edges: [] }
    for (const caller of [{}, { profile: 'interactive' as const, sessionId: 'term-1' }]) {
      await expect(toolset.call('propose_workflow', { graph, summary: 'x' }, caller)).rejects.toThrow(/only accepted/)
    }
    expect(sink).not.toHaveBeenCalled()
  })

  it('refuses set_node_output from a caller with no bound agent node', async () => {
    const sink = vi.fn()
    const sessions = new AgentSessionSinks()
    sessions.bind('node-a', { nodeOutput: sink })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), sessions })
    await expect(toolset.call('set_node_output', { data: { x: 1 } })).rejects.toThrow(/only accepted/)
    await expect(
      toolset.call('set_node_output', { data: { x: 1 } }, { profile: 'workflow', sessionId: 'node-b' }),
    ).rejects.toThrow(/only accepted/)
    expect(sink).not.toHaveBeenCalled()
    await toolset.call('set_node_output', { data: { x: 2 } }, { profile: 'workflow', sessionId: 'node-a' })
    expect(sink).toHaveBeenCalledWith({ x: 2 })
  })

  it('marks a target a headless agent records, and leaves an interactive one as before', async () => {
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
    const headless = (await toolset.call('upsert_target', { kind: 'domain', value: 'h.example' }, { profile: 'workflow', sessionId: 's' })) as { source: string }
    const scope = (await toolset.call('upsert_target', { kind: 'domain', value: 's.example' }, { profile: 'scope', sessionId: 'r' })) as { source: string }
    const interactive = (await toolset.call('upsert_target', { kind: 'domain', value: 'i.example' }, { profile: 'interactive', sessionId: 't' })) as { source: string }
    const master = (await toolset.call('upsert_target', { kind: 'domain', value: 'm.example' })) as { source: string }
    expect(headless.source).toBe(HEADLESS_AGENT_TARGET_SOURCE)
    expect(scope.source).toBe(HEADLESS_AGENT_TARGET_SOURCE)
    expect(interactive.source).toBe('agent')
    expect(master.source).toBe('agent')
  })

  it('runs a command locally and returns captured output', async () => {
    let launchedSpec: LaunchSpec | undefined
    const launcher = fakeLauncher({ stdout: 'hello\n', code: 0, onLaunch: (s) => (launchedSpec = s) })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), launcherFactory: () => launcher })
    const result = (await toolset.call('run_command', { command: 'echo hello' })) as {
      stdout: string
      exit_code: number | null
      backend: string
    }
    expect(result.stdout).toBe('hello\n')
    expect(result.exit_code).toBe(0)
    expect(result.backend).toBe('local')
    expect(launchedSpec).toMatchObject({ program: 'sh', args: ['-lc', 'echo hello'] })
  })

  it('runs a command on a resolved backend profile', async () => {
    const profile = project.backends.create({ name: 'box', kind: 'ssh', host: 'h', user: 'u' })
    let seenProfileId: string | undefined
    const factory = (p: { id: string } | undefined): CommandLauncher => {
      seenProfileId = p?.id
      return fakeLauncher({ stdout: 'remote-out', code: 0 })
    }
    const toolset = new ProjectToolset({
      project,
      runWorkflow: vi.fn(),
      launcherFactory: factory as never,
    })
    const result = (await toolset.call('run_command', { command: 'id', backend: profile.id })) as {
      stdout: string
      backend: string
    }
    expect(seenProfileId).toBe(profile.id)
    expect(result.stdout).toBe('remote-out')
    expect(result.backend).toBe(profile.id)
  })

  it('throws for an unknown backend id', async () => {
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), launcherFactory: () => fakeLauncher({}) })
    await expect(toolset.call('run_command', { command: 'ls', backend: 'ghost' })).rejects.toThrow(/unknown backend/)
  })

  it('rejects an invalid graph proposal without calling the sink', async () => {
    const sink = vi.fn()
    const sessions = new AgentSessionSinks()
    sessions.bind('turn-1', { proposal: sink })
    const toolset = new ProjectToolset({ project, runWorkflow: vi.fn(), sessions })
    // Edge references a missing node → validateGraph fails.
    const graph = { nodes: [{ id: 'a', type: 'manual', data: {} }], edges: [{ id: 'e', source: 'a', target: 'ghost' }] }
    const result = (await toolset.call('propose_workflow', { graph, summary: 'bad' }, { profile: 'assistant', sessionId: 'turn-1' })) as {
      ok: boolean
      errors: string[]
    }
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/ghost/)
    expect(sink).not.toHaveBeenCalled()
  })
})
