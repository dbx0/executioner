import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { Scheduler } from './scheduler.js'

// Expected failures below log a warn line to stderr; keep the test output clean.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const writeSync = ((fd: number, ...rest: unknown[]) =>
    fd === 2 ? 0 : (actual.writeSync as (...a: unknown[]) => number)(fd, ...rest)) as typeof actual.writeSync
  return { ...actual, writeSync }
})

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
    expect(runWorkflow).toHaveBeenLastCalledWith('wf-1', null, null)

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
    expect(runWorkflow).toHaveBeenCalledWith('wf-1', target.id, null)
  })

  it('passes a schedule its backend profile id when firing', async () => {
    vi.useFakeTimers()
    const runWorkflow = vi.fn(async () => undefined)
    project.schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 5, backendProfileId: 'kali-1' })
    const scheduler = new Scheduler({ project, runWorkflow })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(runWorkflow).toHaveBeenLastCalledWith('wf-1', null, 'kali-1')
    scheduler.stop()
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
    // style). Without the cascade guard this would recurse forever.
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

  it('still fires on_create for a target created outside a scheduled run while one is in flight', async () => {
    vi.useFakeTimers()
    project.workflows.create('enum', JSON.stringify({ nodes: [], edges: [] }), { id: 'wf-enum' })
    let release!: () => void
    const runWorkflow = vi.fn((workflowId: string) =>
      workflowId === 'wf-1' ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve(),
    )
    project.schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 60 })
    project.schedules.create({ workflowId: 'wf-enum', kind: 'on_create', targetKind: 'domain' })
    const scheduler = new Scheduler({ project, runWorkflow })
    scheduler.start()

    // The slow interval run is now in flight; the operator adds a target by hand.
    await vi.advanceTimersByTimeAsync(60_000)
    const target = project.targets.upsert({ kind: 'domain', value: 'operator.com', source: 'manual' })
    await scheduler.onTargetCreated(target)
    release()

    expect(runWorkflow).toHaveBeenCalledWith('wf-enum', target.id, null)
    scheduler.stop()
  })

  it('skips an interval tick while the previous run of that schedule is still going', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const runWorkflow = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    project.schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 5 })
    const scheduler = new Scheduler({ project, runWorkflow })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(runWorkflow).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(5000)
    expect(runWorkflow).toHaveBeenCalledTimes(2)
    scheduler.stop()
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

  it('runs a single tool, with its options, when the action names a node instead of a workflow', async () => {
    const runWorkflow = vi.fn(async () => undefined)
    const runNode = vi.fn(async () => undefined)
    project.schedules.create({ nodeType: 'httpx', nodeParams: { rate_limit: 1 }, kind: 'on_create', targetKind: 'domain', backendProfileId: 'kali' })
    const scheduler = new Scheduler({ project, runWorkflow, runNode })

    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    await scheduler.onTargetCreated(target)

    expect(runNode).toHaveBeenCalledWith('httpx', { rate_limit: 1 }, target.id, 'kali')
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('fires an in-scope-only action for an in-scope target and for nothing else', async () => {
    const runWorkflow = vi.fn(async () => undefined)
    project.scopeRules.add({ effect: 'include', pattern: '*.example.com', note: '', source: 'manual' })
    project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'subdomain', inScopeOnly: true })
    const scheduler = new Scheduler({ project, runWorkflow })

    const inside = project.targets.upsert({ kind: 'subdomain', value: 'shop.example.com', source: 'manual' })
    // No rule mentions this one: unknown is not "in scope".
    const unknown = project.targets.upsert({ kind: 'subdomain', value: 'cdn.other.net', source: 'manual' })
    await scheduler.onTargetCreated(inside)
    await scheduler.onTargetCreated(unknown)

    expect(runWorkflow).toHaveBeenCalledTimes(1)
    expect(runWorkflow).toHaveBeenCalledWith('wf-1', inside.id, null)
  })

  it('fires a default action, shared by every engagement, when a matching target is created here', async () => {
    const runWorkflow = vi.fn(async () => undefined)
    project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    const scheduler = new Scheduler({ project, runWorkflow })

    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    await scheduler.onTargetCreated(target)

    expect(runWorkflow).toHaveBeenCalledWith('wf-1', target.id, null)
  })

  it('does not fire a default action this engagement switched off', async () => {
    const runWorkflow = vi.fn(async () => undefined)
    const action = project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    project.defaultOverrides.set(action.id, false)
    const scheduler = new Scheduler({ project, runWorkflow })

    await scheduler.onTargetCreated(project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' }))

    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('runs a tool on a timer against the target the action names', async () => {
    vi.useFakeTimers()
    const runNode = vi.fn(async () => undefined)
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    project.schedules.create({ nodeType: 'tls_cert', kind: 'interval', intervalSeconds: 60, targetId: target.id })
    const scheduler = new Scheduler({ project, runWorkflow: vi.fn(async () => undefined), runNode })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(60_000)
    scheduler.stop()

    expect(runNode).toHaveBeenCalledWith('tls_cert', {}, target.id, null)
  })

  it('leaves a default that ships switched off alone until this engagement turns it on', async () => {
    const runWorkflow = vi.fn(async () => undefined)
    const action = project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain', enabled: false })
    const scheduler = new Scheduler({ project, runWorkflow })

    await scheduler.onTargetCreated(project.targets.upsert({ kind: 'domain', value: 'one.example', source: 'manual' }))
    expect(runWorkflow).not.toHaveBeenCalled()

    project.defaultOverrides.set(action.id, true)
    const target = project.targets.upsert({ kind: 'domain', value: 'two.example', source: 'manual' })
    await scheduler.onTargetCreated(target)
    expect(runWorkflow).toHaveBeenCalledWith('wf-1', target.id, null)
  })
})
