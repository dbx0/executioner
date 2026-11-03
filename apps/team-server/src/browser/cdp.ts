/** CDP payloads are untyped JSON. */
export type Dyn = ReturnType<typeof JSON.parse>

/** Minimal CDP send/on surface (browser or flattened target session). */
export interface Cdp {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Dyn>
  on(event: string, cb: (params: Dyn, sessionId?: string) => void): () => void
  close(): void
}

/**
 * Connect to a Chromium DevTools websocket and speak CDP 1.3.
 * Node 22+ provides global WebSocket.
 */
export async function connectCdp(webSocketUrl: string): Promise<Cdp> {
  const ws = new WebSocket(webSocketUrl)
  await new Promise<void>((resolve, reject) => {
    const onErr = (): void => {
      reject(new Error('CDP websocket failed'))
    }
    ws.addEventListener('error', onErr, { once: true })
    ws.addEventListener(
      'open',
      () => {
        ws.removeEventListener('error', onErr)
        resolve()
      },
      { once: true },
    )
  })

  let nextId = 1
  const pending = new Map<number, { resolve: (v: Dyn) => void; reject: (e: Error) => void }>()
  const listeners = new Map<string, Set<(params: Dyn, sessionId?: string) => void>>()

  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8')
    let msg: Dyn
    try {
      msg = JSON.parse(raw) as Dyn
    } catch {
      return
    }
    if (msg !== null && typeof msg === 'object' && 'id' in msg && typeof (msg as { id: unknown }).id === 'number') {
      const id = (msg as { id: number }).id
      const slot = pending.get(id)
      if (slot === undefined) return
      pending.delete(id)
      if ('error' in msg && msg.error !== undefined) {
        const err = msg.error as { message?: string }
        slot.reject(new Error(err.message ?? 'CDP error'))
      } else {
        slot.resolve((msg as { result?: Dyn }).result ?? null)
      }
      return
    }
    if (msg !== null && typeof msg === 'object' && 'method' in msg && typeof (msg as { method: unknown }).method === 'string') {
      const method = (msg as { method: string }).method
      const params = ((msg as { params?: Dyn }).params ?? {}) as Dyn
      const sessionId =
        'sessionId' in msg && typeof (msg as { sessionId: unknown }).sessionId === 'string'
          ? (msg as { sessionId: string }).sessionId
          : undefined
      const set = listeners.get(method)
      if (set === undefined) return
      for (const cb of set) cb(params, sessionId)
    }
  })

  ws.addEventListener('close', () => {
    for (const [, slot] of pending) slot.reject(new Error('CDP websocket closed'))
    pending.clear()
    listeners.clear()
  })

  return {
    send(method, params, sessionId) {
      const id = nextId++
      return new Promise<Dyn>((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('CDP websocket not open'))
          return
        }
        pending.set(id, { resolve, reject })
        const payload: Record<string, unknown> = { id, method, params: params ?? {} }
        if (sessionId !== undefined && sessionId !== '') payload.sessionId = sessionId
        ws.send(JSON.stringify(payload))
      })
    },
    on(event, cb) {
      let set = listeners.get(event)
      if (set === undefined) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(cb)
      return () => {
        set!.delete(cb)
        if (set!.size === 0) listeners.delete(event)
      }
    },
    close() {
      for (const [, slot] of pending) slot.reject(new Error('CDP closed'))
      pending.clear()
      listeners.clear()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
    },
  }
}
