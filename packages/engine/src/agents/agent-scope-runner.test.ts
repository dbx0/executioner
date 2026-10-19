import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { AgentScopeRunner, buildScopePrompt } from './agent-scope-runner.js'

let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-scope-run-'))
  project = createProject(dir, { name: 'acme' })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

function collect(bus: EventBus): EngineEvent[] {
  const out: EngineEvent[] = []
  bus.subscribe((e) => out.push(e))
  return out
}

describe('AgentScopeRunner (AI-only)', () => {
  it('adds nothing and reports when no capable agent is configured', async () => {
    const bus = new EventBus()
    const events = collect(bus)
    const summary = await new AgentScopeRunner({ bus, project, cwd: dir }).run({
      // The scope is prose — it must NOT be regex-parsed into targets.
      scope: '1.No transactions without a signer. Contact john@bugcrowdninja.com. *.example.com',
      runId: 'r',
    })
    expect(summary.added).toEqual([])
    expect(summary.total).toBe(0)
    expect(project.targets.all()).toHaveLength(0)
    const done = events.filter((e) => e.type === 'agent' && e.nodeId === 'scope-done')
    expect(done).toHaveLength(1)
  })

  it('reports exactly the targets the agent registered via MCP', async () => {
    const bus = new EventBus()
    // Simulate the agent: it reads the scope and upserts the real in-scope hosts.
    const runAgent = vi.fn(async () => {
      project.targets.upsert({ kind: 'subdomain', value: 'passport.example.com', source: 'agent' })
      project.targets.upsert({ kind: 'subdomain', value: 'auth.example.com', source: 'agent' })
    })
    const summary = await new AgentScopeRunner({ bus, project, cwd: dir, runAgent }).run({
      scope: 'passport.example.com and auth.example.com (example email john@bugcrowdninja.com)',
      runId: 'r',
    })
    expect(runAgent).toHaveBeenCalledWith({ scope: expect.any(String), description: '', runId: 'r' })
    expect(summary.added.map((e) => e.value).sort()).toEqual(['auth.example.com', 'passport.example.com'])
    // The prose (email domain, "1.No", wildcards) is never turned into a target.
    // The tree also holds the apex it derived to parent them, marked as such.
    const registered = project.targets.all().filter((t) => t.source !== 'derived')
    expect(registered.map((t) => t.value).sort()).toEqual(['auth.example.com', 'passport.example.com'])
    expect(project.targets.all().filter((t) => t.source === 'derived').map((t) => t.value)).toEqual([
      'example.com',
    ])
  })

  it('does not re-report targets that already existed before the run', async () => {
    project.targets.upsert({ kind: 'subdomain', value: 'passport.example.com', source: 'manual' })
    const bus = new EventBus()
    const runAgent = vi.fn(async () => {
      project.targets.upsert({ kind: 'subdomain', value: 'passport.example.com', source: 'agent' }) // idempotent
      project.targets.upsert({ kind: 'subdomain', value: 'auth.example.com', source: 'agent' })
    })
    const summary = await new AgentScopeRunner({ bus, project, cwd: dir, runAgent }).run({ scope: 's', runId: 'r' })
    expect(summary.added.map((e) => e.value)).toEqual(['auth.example.com'])
  })

  it('emits progress bubbles for added targets and a final done event', async () => {
    const bus = new EventBus()
    const events = collect(bus)
    const runAgent = vi.fn(async () => {
      project.targets.upsert({ kind: 'subdomain', value: 'a.example.com', source: 'agent' })
      project.targets.upsert({ kind: 'subdomain', value: 'b.example.com', source: 'agent' })
    })
    await new AgentScopeRunner({ bus, project, cwd: dir, runAgent }).run({ scope: 's', runId: 'run-x' })

    const agentEvents = events.filter((e) => e.type === 'agent' && e.executionId === 'run-x')
    expect(agentEvents.filter((e) => e.nodeId === 'scope-progress').length).toBeGreaterThanOrEqual(2)
    const done = agentEvents.filter((e) => e.nodeId === 'scope-done')
    expect(done).toHaveLength(1)
    expect((JSON.parse(done[0]!.data) as { total: number }).total).toBe(2)
  })

  it('reports the agent failure and adds nothing when the agent throws', async () => {
    const bus = new EventBus()
    const runAgent = vi.fn().mockRejectedValue(new Error('claude not found'))
    const summary = await new AgentScopeRunner({ bus, project, cwd: dir, runAgent }).run({ scope: 's', runId: 'r' })
    expect(summary.added).toEqual([])
    expect(project.targets.all()).toHaveLength(0)
  })
})

describe('buildScopePrompt', () => {
  it('asks for two passes when there are no notes to tidy', () => {
    const prompt = buildScopePrompt('*.example.com')
    expect(prompt).toContain('two passes')
    expect(prompt).not.toContain('PASS 0')
    expect(prompt).not.toContain('NOTES:')
  })

  it('adds the brief pass, and the notes, when the operator wrote some', () => {
    const prompt = buildScopePrompt('*.example.com', '  pays 500 for rce. no DoS.  ')
    expect(prompt).toContain('three passes')
    expect(prompt).toContain('PASS 0')
    expect(prompt).toContain('mcp__project__set_program_description')
    expect(prompt).toContain('pays 500 for rce. no DoS.')
    // The instruction that keeps it a reformat rather than a rewrite.
    expect(prompt).toContain('Reformat only')
  })

  it('treats blank notes as none', () => {
    expect(buildScopePrompt('*.example.com', '   \n  ')).toBe(buildScopePrompt('*.example.com'))
  })
})

describe('the brief pass', () => {
  it('hands the description to the agent alongside the scope', async () => {
    const bus = new EventBus()
    const runAgent = vi.fn(async () => undefined)
    await new AgentScopeRunner({ bus, project, cwd: dir, runAgent }).run({
      scope: '*.example.com',
      description: 'raw notes',
      runId: 'r',
    })
    expect(runAgent).toHaveBeenCalledWith({ scope: '*.example.com', description: 'raw notes', runId: 'r' })
  })

  it('says it is reading the brief too', async () => {
    const bus = new EventBus()
    const events = collect(bus)
    await new AgentScopeRunner({ bus, project, cwd: dir }).run({
      scope: '*.example.com',
      description: 'raw notes',
      runId: 'r',
    })
    const first = events.find((e) => e.type === 'agent' && e.nodeId === 'scope-progress')
    expect(String((first as { data: string }).data)).toContain('brief')
  })
})
