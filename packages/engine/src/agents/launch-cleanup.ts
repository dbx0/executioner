import { engineLog, errorFields } from '../infra/log.js'

/** Hands a launch builder a place to register work that must run when the agent exits. */
export type DeferCleanup = (cleanup: () => void) => void

/**
 * The cleanups for one agent launch: revoking its scoped token and deleting the
 * temp files that carry it. Runs each once; a cleanup that throws does not stop
 * the rest.
 */
export class LaunchCleanup {
  private readonly pending: Array<() => void> = []

  readonly defer: DeferCleanup = (cleanup) => {
    this.pending.push(cleanup)
  }

  readonly run = (): void => {
    for (const cleanup of this.pending.splice(0)) {
      try {
        cleanup()
      } catch (e) {
        /* best-effort: the next cleanup still runs */
        engineLog.warn('agents', 'Launch cleanup step failed', errorFields(e))
      }
    }
  }
}
