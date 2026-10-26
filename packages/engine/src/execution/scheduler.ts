import { AsyncLocalStorage } from 'node:async_hooks'
import type { Project } from '@exe/project'
import type { Schedule } from '@exe/db'
import type { Target } from '@exe/protocol'

/** Runs a workflow by id against an optional target; resolves when the run finishes. */
export interface RunScheduledWorkflow {
  (workflowId: string, targetId: string | null): Promise<unknown>
}

export interface SchedulerDeps {
  project: Project
  /** Reuses the same GraphExecutor path the run route uses. */
  runWorkflow: RunScheduledWorkflow
}

/**
 * Fires workflow triggers over time:
 * - `interval` schedules run their workflow every `intervalSeconds` seconds.
 * - `on_create` schedules run their workflow whenever a matching target is
 *   created (driven by the target-create route via {@link onTargetCreated}).
 *
 * Best-effort: a failing run is swallowed so one bad workflow never stops the
 * timer loop. An interval tick that lands while the schedule's previous run is
 * still going is skipped, so a slow workflow never piles up concurrent runs. Call {@link start} once the engine is up and {@link stop} on
 * shutdown.
 */
export class Scheduler {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>()
  /**
   * Set for the async context of every scheduler-initiated workflow run. Used to
   * suppress `on_create` cascades: targets a scheduled run discovers must not
   * re-trigger `on_create`, or a workflow that emits its own trigger kind (e.g.
   * a subdomain-enum workflow scheduled on `on_create` for `subdomain`) would
   * loop forever. Scoped to the run's own context, so a target the operator
   * adds while some unrelated scheduled run is going still fires.
   */
  private readonly scheduledRun = new AsyncLocalStorage<true>()
  /** Interval schedules whose previous run has not settled yet. */
  private readonly runningSchedules = new Set<string>()
  /** Trigger handling and runs not yet settled. The engine fires these and forgets them. */
  private readonly inFlight = new Set<Promise<unknown>>()

  constructor(private readonly deps: SchedulerDeps) {}

  /** Records `work` as in flight until it settles. */
  private track<T>(work: Promise<T>): Promise<T> {
    this.inFlight.add(work)
    const settled = (): void => {
      this.inFlight.delete(work)
    }
    work.then(settled, settled)
    return work
  }

  /**
   * Resolves once nothing the scheduler started is still running, including
   * runs started while it waits. Lets a caller (a test, or a shutdown that
   * closes the project) wait for a fire-and-forget on_create run instead of
   * guessing how long it takes. An armed interval timer that has not fired yet
   * is not in flight.
   */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight])
  }

  /** Load enabled interval schedules and begin their timers. Idempotent. */
  start(): void {
    this.stop()
    for (const schedule of this.deps.project.schedules.list()) {
      if (
        schedule.enabled &&
        schedule.kind === 'interval' &&
        schedule.intervalSeconds !== null &&
        schedule.intervalSeconds > 0
      ) {
        this.arm(schedule)
      }
    }
  }

  /** Clear every running timer. */
  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
  }

  /** Number of armed interval timers (test/observability aid). */
  get activeCount(): number {
    return this.timers.size
  }

  private arm(schedule: Schedule): void {
    const ms = (schedule.intervalSeconds ?? 0) * 1000
    if (ms <= 0) return
    const timer = setInterval(() => {
      if (this.runningSchedules.has(schedule.id)) return
      this.runningSchedules.add(schedule.id)
      void this.fire(schedule.workflowId, schedule.targetId).finally(() => {
        this.runningSchedules.delete(schedule.id)
      })
    }, ms)
    // Do not keep the process alive purely for a schedule timer.
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
    this.timers.set(schedule.id, timer)
  }

  private fire(workflowId: string, targetId: string | null): Promise<void> {
    return this.track(this.runOnce(workflowId, targetId))
  }

  private async runOnce(workflowId: string, targetId: string | null): Promise<void> {
    try {
      await this.scheduledRun.run(true, () => this.deps.runWorkflow(workflowId, targetId))
    } catch {
      /* best-effort: a failed scheduled run must not break the loop */
    }
  }

  /**
   * Called when a target is created (by the target-create route or by a tool
   * node's `project.targets.upsert` — the engine wraps the repository so both
   * reach here). Reads enabled `on_create` schedules live from the DB and runs
   * every one whose `targetKind` matches the new target, against that target.
   *
   * Targets created by a scheduler-initiated run are ignored (see
   * {@link scheduledRun}) so a workflow cannot cascade into itself.
   */
  onTargetCreated(target: Target): Promise<void> {
    return this.track(this.runMatching(target))
  }

  private async runMatching(target: Target): Promise<void> {
    if (this.scheduledRun.getStore() === true) return
    for (const schedule of this.deps.project.schedules.list()) {
      if (schedule.enabled && schedule.kind === 'on_create' && schedule.targetKind === target.kind) {
        await this.fire(schedule.workflowId, target.id)
      }
    }
  }
}
