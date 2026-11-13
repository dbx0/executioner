import { AsyncLocalStorage } from 'node:async_hooks'
import type { Project } from '@exe/project'
import type { Schedule } from '@exe/db'
import type { Target } from '@exe/protocol'
import { engineLog, errorFields } from '../infra/log.js'

/** Runs a workflow by id against an optional target on an optional backend
 *  profile; resolves when the run finishes. */
export interface RunScheduledWorkflow {
  (workflowId: string, targetId: string | null, backendProfileId?: string | null): Promise<unknown>
}

/** Runs one node (a tool, or a built-in recon node) against a target; resolves when it finishes. */
export interface RunScheduledNode {
  (nodeType: string, params: Record<string, unknown>, targetId: string | null, backendProfileId?: string | null): Promise<unknown>
}

export interface SchedulerDeps {
  project: Project
  /** Reuses the same GraphExecutor path the run route uses. */
  runWorkflow: RunScheduledWorkflow
  /** How an action that names a single node runs it. Absent → such actions are skipped. */
  runNode?: RunScheduledNode
}

/**
 * Fires actions over time. An action runs a workflow or a single node:
 * - `interval` actions run every `intervalSeconds` seconds.
 * - `on_create` actions run whenever a matching target is created (driven by
 *   the target-create route via {@link onTargetCreated}). These come from two
 *   places: the engagement's own, and the defaults every engagement shares,
 *   each as this engagement has it switched.
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
    engineLog.debug('scheduler', 'Scheduler started', { intervals: this.timers.size })
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
      void this.fire(schedule, schedule.targetId).finally(() => {
        this.runningSchedules.delete(schedule.id)
      })
    }, ms)
    // Do not keep the process alive purely for a schedule timer.
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
    this.timers.set(schedule.id, timer)
  }

  private fire(action: Schedule, targetId: string | null): Promise<void> {
    return this.track(this.runOnce(action, targetId))
  }

  private async runOnce(action: Schedule, targetId: string | null): Promise<void> {
    const what = action.workflowId !== null ? { workflow: action.workflowId } : { node: action.nodeType }
    engineLog.debug('scheduler', 'Scheduled run starting', what)
    try {
      await this.scheduledRun.run(true, async () => {
        if (action.workflowId !== null) {
          await this.deps.runWorkflow(action.workflowId, targetId, action.backendProfileId)
        } else if (action.nodeType !== null && this.deps.runNode !== undefined) {
          await this.deps.runNode(action.nodeType, action.nodeParams ?? {}, targetId, action.backendProfileId)
        }
      })
    } catch (e) {
      /* best-effort: a failed scheduled run must not break the loop */
      engineLog.warn('scheduler', 'Scheduled run failed', { ...what, ...errorFields(e) })
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
    const { project } = this.deps
    // A default fires here when this engagement switched it on, or made no
    // choice and the default itself is on.
    const defaults = project.defaultActions
      .list()
      .map((action) => ({ ...action, enabled: project.defaultOverrides.get(action.id) ?? action.enabled }))
    for (const action of [...defaults, ...project.schedules.list()]) {
      if (!action.enabled || action.kind !== 'on_create' || action.targetKind !== target.kind) continue
      // "In scope" means a rule includes it. A target no rule mentions is a
      // question for the operator, not something to act on unattended.
      if (action.inScopeOnly && target.scopeStatus !== 'in') continue
      await this.fire(action, target.id)
    }
  }
}
