interface StepState {
  /** Gate resolvers waiting for a step permit, in FIFO order. */
  resolvers: Array<() => void>
  /** Banked permits: a step called with no waiter increments this. */
  permits: number
  /** Once resumed, every current and future gate resolves immediately. */
  resumed: boolean
}

/**
 * A registry of per-execution gates. A stepped run registers an execution, and
 * each node awaits `gate(...)` before doing work. The run route releases nodes
 * one at a time with `step(...)` or lets the rest flow with `resume(...)`.
 */
export class StepController {
  private readonly states = new Map<string, StepState>()

  /** Begin tracking a stepped run for `executionId`. */
  register(executionId: string): void {
    this.states.set(executionId, { resolvers: [], permits: 0, resumed: false })
  }

  /** Whether `executionId` is a currently tracked stepped run. */
  has(executionId: string): boolean {
    return this.states.has(executionId)
  }

  /**
   * Resolves when a step permit is available or the run was resumed. If the
   * execution is not registered (already resumed/cleaned up), resolves at once.
   */
  gate(executionId: string, _nodeId: string): Promise<void> {
    const state = this.states.get(executionId)
    if (state === undefined || state.resumed) return Promise.resolve()
    if (state.permits > 0) {
      state.permits -= 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      state.resolvers.push(resolve)
    })
  }

  /** Release exactly one waiting gate; if none waiting, bank a permit. */
  step(executionId: string): void {
    const state = this.states.get(executionId)
    if (state === undefined) return
    const next = state.resolvers.shift()
    if (next !== undefined) {
      next()
      return
    }
    state.permits += 1
  }

  /** Resolve all current and future gates for this execution. */
  resume(executionId: string): void {
    const state = this.states.get(executionId)
    if (state === undefined) return
    state.resumed = true
    const pending = state.resolvers
    state.resolvers = []
    for (const resolve of pending) resolve()
  }

  /** Drop all state for `executionId`. Call when the run finishes. */
  unregister(executionId: string): void {
    this.states.delete(executionId)
  }
}
