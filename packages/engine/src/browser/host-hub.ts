import { randomUUID } from 'node:crypto'
import { BROWSER_APP_CLOSED, type BrowserAction, type BrowserCall, type BrowserReply } from '@exe/protocol'

export interface HostSocket {
  send(data: string): void
  close(): void
  on(ev: 'message', cb: (d: unknown) => void): void
  on(ev: 'close', cb: () => void): void
  on(ev: 'error', cb: (err: Error) => void): void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** The one desktop host socket, and the calls waiting on its answers. */
export class BrowserHostHub {
  private host: HostSocket | undefined
  private readonly pending = new Map<string, Pending>()
  private readonly timeoutMs: number

  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 60_000
  }

  /** A newer host replaces the older one, which is closed. */
  attach(socket: HostSocket): void {
    const previous = this.host
    this.host = socket
    if (previous !== undefined) {
      this.failAll()
      previous.close()
    }
    socket.on('message', (data) => this.onMessage(data))
    // Without a listener a socket error is thrown as an uncaught exception and
    // takes the engine down; 'close' follows it and does the cleanup.
    socket.on('error', () => {})
    socket.on('close', () => {
      if (this.host !== socket) return
      this.host = undefined
      this.failAll()
    })
  }

  connected(): boolean {
    return this.host !== undefined
  }

  call(browserId: string, action: BrowserAction, args: Record<string, unknown>): Promise<unknown> {
    const host = this.host
    if (host === undefined) return Promise.reject(new Error(BROWSER_APP_CLOSED))
    const id = randomUUID()
    const message: BrowserCall = { id, browserId, action, args, agent: true }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The browser did not answer in time.'))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        host.send(JSON.stringify(message))
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  private onMessage(data: unknown): void {
    let reply: BrowserReply
    try {
      reply = JSON.parse(String(data)) as BrowserReply
    } catch {
      return
    }
    const entry = this.pending.get(reply.id)
    if (entry === undefined) return
    this.pending.delete(reply.id)
    clearTimeout(entry.timer)
    if (reply.ok) entry.resolve(reply.result)
    else entry.reject(new Error(reply.error))
  }

  private failAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(BROWSER_APP_CLOSED))
      this.pending.delete(id)
    }
  }
}
