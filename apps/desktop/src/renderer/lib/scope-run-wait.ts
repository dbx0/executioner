import { eventsUrl, type EngineConnection } from './connection.js'
import { parseEngineEvent } from './events.js'

export type ScopeRunWaitResult = 'done' | 'timeout' | 'error'

type AgentHandler = (runId: string, event: string, payload: Record<string, unknown>) => void

/**
 * Watch engine `/events` for one scope parse. Open the socket *before* POSTing
 * `/scope/parse` so a fast `scope-done` is not missed while Shell reconnects
 * after createEngagement (that race leaves the modal on "Parsing scope…").
 */
export class ScopeRunWatcher {
  private readonly ws: WebSocket
  private runId: string | null = null
  private settle: ((result: ScopeRunWaitResult) => void) | null = null
  private early: ScopeRunWaitResult | null = null
  private readonly timer: ReturnType<typeof setTimeout>
  private closed = false

  readonly ready: Promise<void>

  constructor(
    connection: EngineConnection,
    private readonly onEvent: AgentHandler,
    timeoutMs = 180_000,
  ) {
    this.ws = new WebSocket(eventsUrl(connection))
    this.timer = setTimeout(() => this.finish('timeout'), timeoutMs)
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => {
        this.finish('error')
        reject(new Error('events socket failed'))
      }
    })
    this.ws.onmessage = (message) => {
      const e = parseEngineEvent(String(message.data))
      if (e?.type !== 'agent') return
      if (this.runId !== null && e.executionId !== this.runId) return
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(e.data) as Record<string, unknown>
      } catch {
        /* ignore malformed */
      }
      const id = this.runId ?? e.executionId
      this.onEvent(id, e.nodeId, payload)
      if (e.nodeId === 'scope-done') this.finish('done')
    }
  }

  /** Bind the run id returned by POST /scope/parse, then await scope-done. */
  waitFor(runId: string): Promise<ScopeRunWaitResult> {
    this.runId = runId
    if (this.early !== null) return Promise.resolve(this.early)
    return new Promise((resolve) => {
      this.settle = resolve
    })
  }

  close(): void {
    this.finish('timeout')
  }

  private finish(result: ScopeRunWaitResult): void {
    if (this.closed) {
      return
    }
    this.closed = true
    clearTimeout(this.timer)
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
    const settle = this.settle
    this.settle = null
    if (settle !== null) settle(result)
    else this.early = result
  }
}
