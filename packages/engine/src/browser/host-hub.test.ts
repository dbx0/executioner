import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { BROWSER_APP_CLOSED, type BrowserCall } from '@exe/protocol'
import { BrowserHostHub } from './host-hub.js'

class FakeSocket extends EventEmitter {
  sent: string[] = []
  closed = false
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
  }
}

const attach = (hub: BrowserHostHub): FakeSocket => {
  const socket = new FakeSocket()
  hub.attach(socket)
  return socket
}

describe('BrowserHostHub', () => {
  it('a socket error does not throw', () => {
    const socket = attach(new BrowserHostHub())
    expect(() => socket.emit('error', new Error('reset'))).not.toThrow()
  })

  it('call without a host fails with the app-closed error', async () => {
    const hub = new BrowserHostHub()
    await expect(hub.call('b1', 'snapshot', {})).rejects.toThrow(BROWSER_APP_CLOSED)
  })

  it('call resolves with the matching reply', async () => {
    const hub = new BrowserHostHub()
    const socket = attach(hub)
    const result = hub.call('b1', 'navigate', { url: 'https://example.com' })
    const call = JSON.parse(socket.sent[0] ?? '') as BrowserCall
    expect(call).toMatchObject({ browserId: 'b1', action: 'navigate', args: { url: 'https://example.com' }, agent: true })
    socket.emit('message', JSON.stringify({ id: 'unknown', ok: true, result: 'ignored' }))
    socket.emit('message', JSON.stringify({ id: call.id, ok: true, result: { done: 1 } }))
    expect(await result).toEqual({ done: 1 })
  })

  it('ok false rejects with the reply error', async () => {
    const hub = new BrowserHostHub()
    const socket = attach(hub)
    const result = hub.call('b1', 'click', {})
    const call = JSON.parse(socket.sent[0] ?? '') as BrowserCall
    socket.emit('message', JSON.stringify({ id: call.id, ok: false, error: 'boom' }))
    await expect(result).rejects.toThrow('boom')
  })

  it('times out', async () => {
    const hub = new BrowserHostHub({ timeoutMs: 20 })
    attach(hub)
    await expect(hub.call('b1', 'snapshot', {})).rejects.toThrow('The browser did not answer in time.')
  })

  it('a new host replaces the old one and pending calls fail', async () => {
    const hub = new BrowserHostHub()
    const first = attach(hub)
    const pending = hub.call('b1', 'snapshot', {})
    const second = attach(hub)
    await expect(pending).rejects.toThrow(BROWSER_APP_CLOSED)
    expect(first.closed).toBe(true)
    first.emit('close')
    expect(hub.connected()).toBe(true)
    void hub.call('b1', 'snapshot', {}).catch(() => undefined)
    expect(second.sent).toHaveLength(1)
  })
})
