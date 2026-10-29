import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { publishChanges } from './change-events.js'
import { EventBus, type EngineEvent } from './events.js'

let dir: string
let project: Project
let bus: EventBus
let events: EngineEvent[]
let uninstall: () => void

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'exe-change-events-'))
  project = createProject(dir, { name: 'test' })
  bus = new EventBus()
  events = []
  bus.subscribe((e) => events.push(e))
  uninstall = publishChanges(project, bus)
})

afterEach(() => {
  uninstall()
  vi.useRealTimers()
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const topics = (): string[] => events.filter((e) => e.type === 'change').map((e) => e.nodeId)

describe('publishChanges', () => {
  it('publishes one targets change for a burst of upserts', () => {
    for (let i = 0; i < 50; i++) project.targets.upsert({ kind: 'domain', value: `h${i}.example.com`, source: 'test' })
    vi.advanceTimersByTime(250)
    const changes = events.filter((e) => e.type === 'change')
    expect(changes).toHaveLength(1)
    expect(changes[0]?.nodeId).toBe('targets')
  })

  it('publishes separate events per topic', () => {
    project.findings.create({ title: 'XSS', severity: 'high' })
    project.scopeRules.add({ effect: 'include', pattern: '*.example.com' })
    vi.advanceTimersByTime(250)
    expect(topics()).toContain('findings')
    expect(topics()).toContain('scope')
  })

  it('publishes again after the window closes', () => {
    project.targets.upsert({ kind: 'domain', value: 'a.example.com', source: 'test' })
    vi.advanceTimersByTime(250)
    project.targets.upsert({ kind: 'domain', value: 'b.example.com', source: 'test' })
    vi.advanceTimersByTime(250)
    expect(topics()).toEqual(['targets', 'targets'])
  })

  it('returns the original result', () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'a.example.com', source: 'test' })
    expect(project.targets.get(target.id)).toEqual(target)
  })

  it('uninstall restores the methods', () => {
    uninstall()
    project.targets.upsert({ kind: 'domain', value: 'a.example.com', source: 'test' })
    vi.advanceTimersByTime(500)
    expect(events).toHaveLength(0)
  })
})
