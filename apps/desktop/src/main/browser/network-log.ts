import type { Dyn } from './cdp-driver'

export interface NetEntry {
  seq: number
  requestId: string
  sessionId?: string
  at: number
  method: string
  url: string
  resourceType?: string
  /** The headers as the page issued them, before any rewrite rule and before the network stack adds its own. */
  requestHeaders: Record<string, string>
  /** The headers that actually went out on the wire (Network.requestWillBeSentExtraInfo), cookies included. */
  sentHeaders?: Record<string, string>
  postData?: string
  postDataTruncated?: boolean
  status?: number
  statusText?: string
  responseHeaders?: Record<string, string>
  /** The response headers as they came off the wire (Network.responseReceivedExtraInfo), Set-Cookie included. */
  receivedHeaders?: Record<string, string>
  mimeType?: string
  failed?: string
  durationMs?: number
  rewrittenBy?: string
  /** The headers the rewrite rule handed on: request headers at the request stage, response headers at the response stage. */
  rewrittenHeaders?: Record<string, string>
}

const MAX_POST_DATA = 64 * 1024

function flattenHeaders(raw: Dyn): Record<string, string> {
  const out: Record<string, string> = {}
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) out[k] = String(v)
  return out
}

/** A bounded, cursor-read record of the page's network traffic. Entries update in place as a request progresses. */
export class NetworkLog {
  private entries: NetEntry[] = []
  private readonly byId = new Map<string, NetEntry>()
  private readonly started = new WeakMap<NetEntry, number>()
  private seq = 0
  /** ExtraInfo that came before its request (or for a later redirect hop), oldest request id first. */
  private readonly pendingSent = new Map<string, Record<string, string>[]>()
  private readonly pendingReceived = new Map<string, Record<string, string>[]>()

  constructor(
    private readonly cap = 1000,
    private readonly pendingCap = 500,
  ) {}

  /** The wire request headers. They can come before or after requestWillBeSent, so an early one waits. */
  requestWillBeSentExtraInfo(p: Dyn): void {
    if (typeof p?.requestId !== 'string') return
    const headers = flattenHeaders(p.headers)
    const entry = this.byId.get(p.requestId)
    // An entry that already has wire headers is an earlier redirect hop: these belong to the next one.
    if (entry && entry.sentHeaders === undefined) entry.sentHeaders = headers
    else this.buffer(this.pendingSent, p.requestId, headers)
  }

  /** The wire response headers, Set-Cookie included. */
  responseReceivedExtraInfo(p: Dyn): void {
    if (typeof p?.requestId !== 'string') return
    const headers = flattenHeaders(p.headers)
    const entry = this.byId.get(p.requestId)
    if (entry && entry.receivedHeaders === undefined) entry.receivedHeaders = headers
    else this.buffer(this.pendingReceived, p.requestId, headers)
  }

  private buffer(map: Map<string, Record<string, string>[]>, requestId: string, headers: Record<string, string>): void {
    const queue = map.get(requestId) ?? []
    queue.push(headers)
    map.delete(requestId)
    map.set(requestId, queue)
    while (map.size > this.pendingCap) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }

  private take(map: Map<string, Record<string, string>[]>, requestId: string): Record<string, string> | undefined {
    const queue = map.get(requestId)
    if (!queue) return undefined
    const first = queue.shift()
    if (queue.length === 0) map.delete(requestId)
    return first
  }

  requestWillBeSent(p: Dyn, sessionId?: string): void {
    if (typeof p?.requestId !== 'string') return
    const previous = this.byId.get(p.requestId)
    if (previous && p.redirectResponse) this.applyResponse(previous, p.redirectResponse, p.timestamp)
    const req = p.request ?? {}
    const entry: NetEntry = {
      seq: ++this.seq,
      requestId: p.requestId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      at: Date.now(),
      method: String(req.method ?? 'GET'),
      url: String(req.url ?? ''),
      ...(typeof p.type === 'string' ? { resourceType: p.type } : {}),
      requestHeaders: flattenHeaders(req.headers),
    }
    if (typeof req.postData === 'string') {
      entry.postData = req.postData.slice(0, MAX_POST_DATA)
      if (req.postData.length > MAX_POST_DATA) entry.postDataTruncated = true
    }
    const wire = this.take(this.pendingSent, p.requestId)
    if (wire !== undefined) entry.sentHeaders = wire
    if (typeof p.timestamp === 'number') this.started.set(entry, p.timestamp)
    this.entries.push(entry)
    this.byId.set(entry.requestId, entry)
    if (this.entries.length > this.cap) {
      for (const dropped of this.entries.splice(0, this.entries.length - this.cap)) {
        if (this.byId.get(dropped.requestId) === dropped) this.byId.delete(dropped.requestId)
      }
    }
  }

  responseReceived(p: Dyn): void {
    const entry = this.byId.get(p?.requestId)
    if (!entry || !p.response) return
    this.applyResponse(entry, p.response)
    if (typeof p.type === 'string') entry.resourceType = p.type
    if (entry.receivedHeaders === undefined) {
      const wire = this.take(this.pendingReceived, p.requestId)
      if (wire !== undefined) entry.receivedHeaders = wire
    }
  }

  loadingFinished(p: Dyn): void {
    const entry = this.byId.get(p?.requestId)
    if (entry) this.finish(entry, p.timestamp)
  }

  loadingFailed(p: Dyn): void {
    const entry = this.byId.get(p?.requestId)
    if (!entry) return
    entry.failed = String(p.errorText ?? 'failed')
    this.finish(entry, p.timestamp)
  }

  /** The newest entry for a request id, or undefined once evicted. */
  find(requestId: string): NetEntry | undefined {
    return this.byId.get(requestId)
  }

  /** Marks the entry a rewrite rule acted on, with the headers the rule produced. */
  markRewritten(requestId: unknown, ruleId: string, headers?: readonly { name: string; value: string }[]): void {
    if (typeof requestId !== 'string') return
    const entry = this.byId.get(requestId)
    if (!entry) return
    entry.rewrittenBy = ruleId
    if (headers !== undefined) entry.rewrittenHeaders = Object.fromEntries(headers.map((h) => [h.name, h.value]))
  }

  /**
   * Entries after the cursor. With a limit the first matches are returned and `next` stops at the
   * last one, so a following poll continues where this one ended.
   */
  since(seq = 0, filter: { urlContains?: string; limit?: number } = {}): { entries: NetEntry[]; next: number } {
    const needle = filter.urlContains
    let found = this.entries.filter((e) => e.seq > seq && (needle === undefined || e.url.includes(needle)))
    let next = this.seq
    if (filter.limit !== undefined && found.length > filter.limit) {
      found = found.slice(0, Math.max(0, filter.limit))
      next = found.at(-1)?.seq ?? seq
    }
    return { entries: found, next }
  }

  private applyResponse(entry: NetEntry, res: Dyn, endTs?: unknown): void {
    if (typeof res.status === 'number') entry.status = res.status
    if (typeof res.statusText === 'string') entry.statusText = res.statusText
    entry.responseHeaders = flattenHeaders(res.headers)
    if (typeof res.mimeType === 'string') entry.mimeType = res.mimeType
    if (endTs !== undefined) this.finish(entry, endTs)
  }

  private finish(entry: NetEntry, ts: unknown): void {
    const start = this.started.get(entry)
    entry.durationMs = typeof ts === 'number' && start !== undefined ? Math.max(0, Math.round((ts - start) * 1000)) : Date.now() - entry.at
  }
}
