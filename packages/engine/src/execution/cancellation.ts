/** What a live run keeps: whether it was stopped, and how to stop its work. */
interface RunState {
  cancelled: boolean
  /** Called once when the run is cancelled — a hook per live child process. */
  hooks: Set<() => void>
}

/**
 * A registry of the runs this engine process is currently executing, and the
 * one thing you can do to them from outside: stop them.
 *
 * A run only advances inside the process running it, so cancelling is two
 * halves. The graph executor asks {@link isCancelled} at every node boundary and
 * gives up the walk; whatever is running *right now* is killed through a hook —
 * the node runner registers one for each child process it spawns and releases it
 * the moment that process settles. Without the hook a stop would only take
 * effect when the current tool finished on its own, which for a long scan is no
 * stop at all.
 *
 * Shared by every path that starts a run (the run route, the scheduler, the MCP
 * tool), so a run is cancellable no matter what started it.
 */
export class CancellationRegistry {
  private readonly states = new Map<string, RunState>()

  /** Begin tracking a run this process is about to execute. */
  register(executionId: string): void {
    this.states.set(executionId, { cancelled: false, hooks: new Set() })
  }

  /** Whether this process is executing that run (and could still stop it). */
  isRunning(executionId: string): boolean {
    return this.states.has(executionId)
  }

  isCancelled(executionId: string): boolean {
    return this.states.get(executionId)?.cancelled ?? false
  }

  /**
   * Stop a run: mark it and fire every hook. Returns false when this process
   * isn't executing it — the row may still be `running` from an engine that
   * died under it, which is the caller's problem to settle.
   */
  cancel(executionId: string): boolean {
    const state = this.states.get(executionId)
    if (state === undefined) return false
    if (state.cancelled) return true
    state.cancelled = true
    for (const hook of [...state.hooks]) {
      state.hooks.delete(hook)
      try {
        hook()
      } catch {
        /* a child that is already gone must not stop the rest being killed */
      }
    }
    return true
  }

  /**
   * Register something to do when this run is cancelled — killing a child
   * process. Fires immediately if the run is already cancelled (the process
   * started in the window between the cancel and this call). Returns a release
   * function; call it when the work settles so a finished node's process is
   * never killed by a later stop.
   */
  onCancel(executionId: string, hook: () => void): () => void {
    const state = this.states.get(executionId)
    if (state === undefined) return () => {}
    if (state.cancelled) {
      hook()
      return () => {}
    }
    state.hooks.add(hook)
    return () => state.hooks.delete(hook)
  }

  /** Forget a run once it has finished, cancelled or not. */
  unregister(executionId: string): void {
    this.states.delete(executionId)
  }
}
