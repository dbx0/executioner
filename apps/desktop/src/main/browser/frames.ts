/** One out-of-process iframe the browser attached to as its own CDP session. */
export interface ChildSession {
  sessionId: string
  /** For an iframe target the target id is also its frame id. */
  targetId: string
  url: string
  /** The session the iframe lives in; undefined when it hangs off the page's root session. */
  parentSessionId: string | undefined
}

export interface TargetInfoLike {
  targetId?: string
  type?: string
  url?: string
}

/** Keeps the live out-of-process iframe sessions of one page. */
export class FrameTracker {
  private readonly sessions = new Map<string, ChildSession>()

  /** Records an attached iframe target; returns it, or undefined for any other target type. */
  attach(sessionId: unknown, info: TargetInfoLike | undefined, parentSessionId?: string): ChildSession | undefined {
    if (typeof sessionId !== 'string' || info?.type !== 'iframe' || typeof info.targetId !== 'string') return undefined
    const child: ChildSession = { sessionId, targetId: info.targetId, url: info.url ?? '', parentSessionId }
    this.sessions.set(sessionId, child)
    return child
  }

  /** Forgets a session and every iframe nested under it; returns the ids removed. */
  detach(sessionId: unknown): string[] {
    if (typeof sessionId !== 'string' || !this.sessions.has(sessionId)) return []
    const removed = [sessionId]
    for (const child of this.sessions.values()) {
      if (child.parentSessionId === sessionId) removed.push(...this.detach(child.sessionId))
    }
    this.sessions.delete(sessionId)
    return removed
  }

  list(): ChildSession[] {
    return [...this.sessions.values()]
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  get(sessionId: string): ChildSession | undefined {
    return this.sessions.get(sessionId)
  }

  setUrl(sessionId: string, url: string): void {
    const child = this.sessions.get(sessionId)
    if (child) child.url = url
  }

  /** The iframe session for `frameId` inside `parentSessionId` (undefined = the root session). */
  childFor(parentSessionId: string | undefined, frameId: string): ChildSession | undefined {
    for (const child of this.sessions.values()) {
      if (child.parentSessionId === parentSessionId && child.targetId === frameId) return child
    }
    return undefined
  }

  /** The frame url to tag a log entry with: the iframe's own url, or the fallback for the page. */
  urlOf(sessionId: string | undefined, fallback: string): string {
    return sessionId === undefined ? fallback : (this.sessions.get(sessionId)?.url ?? fallback)
  }
}
