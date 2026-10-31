import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserCall } from '@exe/protocol'
import { BrowserHostClient, type WebSocketLike } from './host-client'

class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closed = false
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
  }
}

const call: BrowserCall = { id: 'c1', browserId: 'b1', action: 'ensure', args: {}, agent: true }

const flush = () => new Promise<void>((r) => setImmediate(r))

afterEach(() => vi.useRealTimers())

describe('BrowserHostClient', () => {
  it('answers a call with ok and the result', async () => {
    const socket = new FakeSocket()
    const run = vi.fn(async () => ({ url: 'u' }))
    new BrowserHostClient({ url: 'ws://x', run, connect: () => socket }).start()
    socket.onmessage?.({ data: JSON.stringify(call) })
    await flush()
    expect(run).toHaveBeenCalledWith(call)
    expect(JSON.parse(socket.sent[0]!)).toEqual({ id: 'c1', ok: true, result: { url: 'u' } })
  })

  it('answers a failing run with ok false and the message', async () => {
    const socket = new FakeSocket()
    const run = vi.fn(async () => {
      throw new Error('boom')
    })
    new BrowserHostClient({ url: 'ws://x', run, connect: () => socket }).start()
    socket.onmessage?.({ data: JSON.stringify(call) })
    await flush()
    expect(JSON.parse(socket.sent[0]!)).toEqual({ id: 'c1', ok: false, error: 'boom' })
  })

  it('reconnects when the socket closes', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const connect = vi.fn(() => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    })
    new BrowserHostClient({ url: 'ws://x', run: async () => null, connect, retryMs: 500 }).start()
    expect(connect).toHaveBeenCalledTimes(1)
    sockets[0]!.onclose?.()
    vi.advanceTimersByTime(499)
    expect(connect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(connect).toHaveBeenCalledTimes(2)
    // Still failing: the delay doubles. A successful open resets it.
    sockets[1]!.onclose?.()
    vi.advanceTimersByTime(999)
    expect(connect).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(connect).toHaveBeenCalledTimes(3)
    sockets[2]!.onopen?.()
    sockets[2]!.onclose?.()
    vi.advanceTimersByTime(500)
    expect(connect).toHaveBeenCalledTimes(4)
  })

  it('stop prevents reconnecting', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const connect = vi.fn(() => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    })
    const client = new BrowserHostClient({ url: 'ws://x', run: async () => null, connect, retryMs: 500 })
    client.start()
    sockets[0]!.onclose?.()
    client.stop()
    vi.advanceTimersByTime(20_000)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('stop closes a live socket', () => {
    const socket = new FakeSocket()
    const client = new BrowserHostClient({ url: 'ws://x', run: async () => null, connect: () => socket })
    client.start()
    client.stop()
    expect(socket.closed).toBe(true)
  })

  it('ignores malformed calls', async () => {
    const socket = new FakeSocket()
    const run = vi.fn(async () => null)
    new BrowserHostClient({ url: 'ws://x', run, connect: () => socket }).start()
    for (const data of ['null', '1', '{}', 'not json', JSON.stringify({ ...call, action: 'rm-rf' })]) {
      socket.onmessage?.({ data })
    }
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(socket.sent).toEqual([])
  })
})
