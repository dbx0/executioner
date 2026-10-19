import { describe, expect, it } from 'vitest'
import type { Project } from '@exe/project'
import { buildProjectBriefing } from './project-briefing.js'

/** A Project stub carrying only what the briefing reads. */
function projectStub(over: {
  name?: string
  backends?: unknown[]
  targets?: { kind: string; value: string }[]
  findings?: { severity: string }[]
  throwOn?: 'backends' | 'targets' | 'findings'
} = {}): Project {
  const fail = (which: string) => {
    if (over.throwOn === which) throw new Error('db unavailable')
  }
  return {
    root: '/tmp/acme',
    config: { name: over.name ?? 'Acme', defaultBackend: 'local', createdAt: '2026-01-01T00:00:00.000Z' },
    backends: {
      list: () => {
        fail('backends')
        return over.backends ?? []
      },
    },
    targets: {
      all: () => {
        fail('targets')
        return over.targets ?? []
      },
    },
    findings: {
      list: () => {
        fail('findings')
        return over.findings ?? []
      },
    },
  } as unknown as Project
}

describe('buildProjectBriefing', () => {
  it('names the engagement and its directory', () => {
    const text = buildProjectBriefing(projectStub({ name: 'Acme Corp' }))
    expect(text).toContain('Engagement: Acme Corp')
    expect(text).toContain('/tmp/acme')
  })

  it('lists remote backends with the id run_command expects', () => {
    const text = buildProjectBriefing(
      projectStub({
        backends: [
          { id: 'b1', name: 'Kali box', kind: 'ssh', host: '10.0.0.5', user: 'root', port: 22, workdir: '/opt/work' },
          { id: 'b2', name: 'Scanner', kind: 'docker', image: 'kali:latest' },
        ],
      }),
    )
    expect(text).toContain('`local`')
    expect(text).toContain('`b1` — Kali box: ssh root@10.0.0.5:22, workdir /opt/work')
    expect(text).toContain('`b2` — Scanner: docker kali:latest')
    // The point of the section: don't assume tooling is on this machine.
    expect(text).toContain('rather than on this machine')
  })

  it('never prints backend env values, only their keys', () => {
    const text = buildProjectBriefing(
      projectStub({ backends: [{ id: 'b1', name: 'Box', kind: 'ssh', host: 'h', user: 'u', env: { AWS_SECRET_ACCESS_KEY: 'hunter2' } }] }),
    )
    expect(text).toContain('AWS_SECRET_ACCESS_KEY')
    expect(text).not.toContain('hunter2')
  })

  it('says so plainly when there is no remote backend', () => {
    const text = buildProjectBriefing(projectStub())
    expect(text).toContain('No remote backend is configured')
  })

  it('lists targets and points at list_targets once there are too many', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'subdomain', value: `h${i}.acme.com` }))
    const text = buildProjectBriefing(projectStub({ targets: many }))
    expect(text).toContain('Targets recorded (30)')
    expect(text).toContain('subdomain h0.acme.com')
    expect(text).toContain('and 5 more')
    expect(text).toContain('list_targets')
  })

  it('breaks findings down worst-first', () => {
    const text = buildProjectBriefing(
      projectStub({
        findings: [
          { severity: 'low' }, { severity: 'high' }, { severity: 'high' },
          { severity: 'info' }, { severity: 'medium' },
        ],
      }),
    )
    expect(text).toContain('Findings recorded: 5 (2 high, 1 medium, 1 low, 1 info)')
  })

  it('prompts recording when the engagement is empty', () => {
    const text = buildProjectBriefing(projectStub())
    expect(text).toContain('upsert_target')
    expect(text).toContain('add_finding')
  })

  it('still briefs when a repository cannot be read', () => {
    // A broken read must degrade the briefing, never block the spawn.
    const text = buildProjectBriefing(projectStub({ throwOn: 'targets' }))
    expect(text).toContain('Engagement: Acme')
    expect(text).toContain('list_targets')
  })

  it('omits every MCP-tool instruction when mcp is off (agents without the toolset)', () => {
    const text = buildProjectBriefing(
      projectStub({
        name: 'Acme',
        targets: [{ kind: 'domain', value: 'acme.com' }],
        findings: [{ severity: 'high' }],
      }),
      undefined,
      { mcp: false },
    )
    // Still orients: engagement, its targets and findings snapshot.
    expect(text).toContain('Engagement: Acme')
    expect(text).toContain('domain acme.com')
    expect(text).toContain('Findings recorded: 1')
    // But never tells the agent to call tools it does not have.
    expect(text).not.toContain('list_targets')
    expect(text).not.toContain('upsert_target')
    expect(text).not.toContain('add_finding')
    expect(text).not.toContain('run_command')
    expect(text).not.toContain('MCP server')
  })
})

describe('buildProjectBriefing — engagement memory', () => {
  it('points the agent at the memory directory and says an empty index is normal', () => {
    const text = buildProjectBriefing(projectStub(), '/home/t/.claude/projects/-tmp-acme/memory')
    expect(text).toContain('/home/t/.claude/projects/-tmp-acme/memory')
    expect(text).toContain('MEMORY.md')
    expect(text).toContain('An empty index is normal')
    // It must steer durable project state to the project, not into memory.
    expect(text).toContain('upsert_target')
  })

  it('omits the memory section entirely when memory is unavailable', () => {
    const text = buildProjectBriefing(projectStub())
    expect(text).not.toContain('Engagement memory:')
  })
})
