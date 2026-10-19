import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { Scheduler } from './scheduler.js'

let dir: string
let project: Project

/** Insert a workflow row so schedules can reference it. */
function seedWorkflow(id: string): void {
  project.workflows.create('wf', JSON.stringify({ nodes: [], edges: [] }), { id })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-scheduler-'))
  project = createProject(dir, { name: 'test' })
  seedWorkflow('wf-1')
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('Scheduler', () => {
  it('runs an interval schedule every intervalSeconds', async () => {
    vi.useFakeTimers()
    const runWorkflow = vi.fn(async () => undefined)
    project.schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 5 })
    const scheduler = new Scheduler({ project, runWorkflow })

    scheduler.start()
    expect(scheduler.activeCount).toBe(1)
    expect(runWorkflow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)
    expect(runWorkflow).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(runWorkflow).toHaveBeenCalledTimes(2)
    expect(runWorkflow).toHaveBeenLastCalledWith('wf-1', null)

    scheduler.stop()
    expect(scheduler.activeCount).toBe(0)
    await vi.advanceTimersByTimeAsync(10000)
    expect(runWorkflow).toHaveBeenCalledTimes(2)
  })

  it('does not arm disabled interval schedules', () => {
    vi.useFakeTimers()
    const s = project.schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 5 })
    project.schedules.setEnabled(s.id, false)
    const scheduler = new Scheduler({ project, runWorkflow: vi.fn() })
    scheduler.start()
    expect(scheduler.activeCount).toBe(0)
  })

  it('fires matching on_create schedules against the created target', async () => {
    const runWorkflow = vi.fn(async () => undefined)
    project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'ip' })
    const scheduler = new Scheduler({ project, runWorkflow })

    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    await scheduler.onTargetCreated(target)

    // Only the domain schedule matches; the ip one is skipped.
    expect(runWorkflow).toHaveBeenCalledTimes(1)
    expect(runWorkflow).toHaveBeenCalledWith('wf-1', target.id)
  })

  it('ignores on_create schedules that are disabled or mismatched', async () => {
    const runWorkflow = vi.fn(async () => undefined)
    const s = project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    project.schedules.setEnabled(s.id, false)
    const scheduler = new Scheduler({ project, runWorkflow })

    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    await scheduler.onTargetCreated(target)
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('does not cascade: targets created inside a run do not re-trigger on_create', async () => {
    // A workflow that itself discovers a new matching target (subdomain-enum
    // style). Without the runDepth guard this would recurse forever.
    let created = 0
    const runWorkflow = vi.fn(async () => {
      // Simulate the running workflow emitting a fresh matching target, which
      // (via the repository wrap in the real engine) calls back into the
      // scheduler. Cap the simulated fan-out so a bug fails as a timeout, not a
      // hang.
      if (created < 5) {
        created += 1
        const t = project.targets.upsert({ kind: 'subdomain', value: `s${created}.example.com`, source: 'workflow' })
        await scheduler.onTargetCreated(t)
      }
    })
    project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'subdomain' })
    const scheduler = new Scheduler({ project, runWorkflow })

    const target = project.targets.upsert({ kind: 'subdomain', value: 'seed.example.com', source: 'manual' })
    await scheduler.onTargetCreated(target)

    // The seed fires exactly one run; the target that run discovers is suppressed.
    expect(runWorkflow).toHaveBeenCalledTimes(1)
  })

  it('idle waits for a fire-and-forget on_create run to finish', async () => {
    let finish!: () => void
    let finished = false
    const runWorkflow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            finished = true
            resolve()
          }
        }),
    )
    project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    const scheduler = new Scheduler({ project, runWorkflow })
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })

    // As the engine's repository wrap does it: started, not awaited.
    void scheduler.onTargetCreated(target)
    let idle = false
    const waiting = scheduler.idle().then(() => (idle = true))
    expect(runWorkflow).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(idle).toBe(false)

    finish()
    await waiting
    expect(finished).toBe(true)
    await expect(scheduler.idle()).resolves.toBeUndefined()
  })

  it('swallows a failing run so the loop survives', async () => {
    const runWorkflow = vi.fn(async () => {
      throw new Error('boom')
    })
    project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    const scheduler = new Scheduler({ project, runWorkflow })
    const target = project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    await expect(scheduler.onTargetCreated(target)).resolves.toBeUndefined()
  })
})
