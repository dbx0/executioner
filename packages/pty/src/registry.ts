import { PtySession, type PtySessionOptions } from './session.js'

/** Tracks live PTY sessions by id and drops them when they exit. */
export class PtyRegistry {
  private readonly sessions = new Map<string, PtySession>()

  create(id: string, options: PtySessionOptions): PtySession {
    const session = new PtySession(options)
    this.sessions.set(id, session)
    // Only remove this session's own entry: a session created later under the
    // same id must not be dropped when the one it replaced exits.
    session.onExit(() => {
      if (this.sessions.get(id) === session) this.sessions.delete(id)
    })
    return session
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id)
  }

  killAll(): void {
    for (const session of this.sessions.values()) session.kill()
    this.sessions.clear()
  }
}
