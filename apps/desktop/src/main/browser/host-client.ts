import { BROWSER_ACTIONS, type BrowserCall, type BrowserReply } from '@exe/protocol'
import { mainLogger } from '../logging/logger'

/** The slice of the WebSocket API the client uses, so tests can fake it. */
export interface WebSocketLike {
  onopen: (() => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(): void
}

export interface BrowserHostClientOptions {
  /** ws://127.0.0.1:<port>/browser-host?token=<token> */
  url: string
  run: (call: BrowserCall) => Promise<unknown>
  connect?: (url: string) => WebSocketLike
  /** First reconnect delay; doubles up to 10s and resets after a successful open. */
  retryMs?: number
}

const MAX_RETRY_MS = 10_000
const BROWSER_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The platform WebSocket behind the slice the client uses. */
function platformSocket(url: string): WebSocketLike {
  const ws = new globalThis.WebSocket(url)
  const like: WebSocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => ws.send(data),
    close: () => ws.close(),
  }
  ws.onopen = () => like.onopen?.()
  ws.onmessage = (e) => like.onmessage?.({ data: e.data })
  ws.onclose = () => like.onclose?.()
  ws.onerror = () => like.onerror?.()
  return like
}

function isAction(v: unknown): v is BrowserCall['action'] {
  return BROWSER_ACTIONS.some((a) => a === v)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A call the engine sent, or undefined when it is not shaped like one. */
function parseCall(data: unknown): BrowserCall | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(String(data))
  } catch {
    return undefined
  }
  if (!isPlainObject(raw)) return undefined
  const { id, browserId, action, args, agent } = raw
  if (typeof id !== 'string') return undefined
  if (typeof browserId !== 'string' || !BROWSER_ID.test(browserId)) return undefined
  if (!isAction(action)) return undefined
  if (!isPlainObject(args)) return undefined
  return { id, browserId, action, args, agent: agent !== false }
}

/**
 * Hosts the embedded browsers for one engine: connects to its /browser-host
 * socket, runs each call it sends and answers with the result. Reconnects with
 * backoff, since the engine may restart while the app stays open.
 */
export class BrowserHostClient {
  private readonly baseMs: number
  private delay: number
  private socket: WebSocketLike | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(private readonly opts: BrowserHostClientOptions) {
    this.baseMs = opts.retryMs ?? 1000
    this.delay = this.baseMs
  }

  start(): void {
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const socket = this.socket
    this.socket = undefined
    if (socket !== undefined) {
      socket.onclose = null
      socket.close()
    }
  }

  private open(): void {
    const socket = (this.opts.connect ?? platformSocket)(this.opts.url)
    this.socket = socket
    socket.onopen = () => {
      this.delay = this.baseMs
    }
    socket.onmessage = (e) => void this.handle(socket, e.data)
    // An error is always followed by a close; the close schedules the retry.
    socket.onerror = () => {}
    socket.onclose = () => {
      if (this.socket === socket) this.socket = undefined
      if (this.stopped) return
      this.timer = setTimeout(() => {
        this.timer = undefined
        if (!this.stopped) this.open()
      }, this.delay)
      this.delay = Math.min(this.delay * 2, MAX_RETRY_MS)
    }
  }

  private async handle(socket: WebSocketLike, data: unknown): Promise<void> {
    const call = parseCall(data)
    if (call === undefined) return
    let reply: BrowserReply
    const started = Date.now()
    try {
      reply = { id: call.id, ok: true, result: await this.opts.run(call) }
    } catch (err) {
      reply = { id: call.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    // The action only: its args carry URLs, selectors and typed text.
    mainLogger()?.debug('main/browser', 'Browser action', {
      action: call.action,
      ok: reply.ok,
      ms: Date.now() - started,
      ...(reply.ok ? {} : { error: reply.error }),
    })
    try {
      socket.send(JSON.stringify(reply))
    } catch {
      // The socket closed while the call ran; the engine fails its pending calls itself.
      mainLogger()?.debug('main/browser', 'Browser reply dropped: engine socket closed', { action: call.action })
    }
  }
}
