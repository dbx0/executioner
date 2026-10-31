import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { BrowserCall } from '@exe/protocol'
import { BrowserHostHub } from './host-hub.js'
import { attachBrowserHostSocket } from './socket.js'

const TOKEN = 'bh-token-bh-token-bh-token-tokn'

let http: Server
let hub: BrowserHostHub
let port: number

beforeEach(async () => {
  hub = new BrowserHostHub()
  http = createServer()
  attachBrowserHostSocket(http, hub, TOKEN)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  port = (http.address() as { port: number }).port
})

afterEach(async () => {
  http.closeAllConnections()
  await new Promise<void>((resolve) => http.close(() => resolve()))
})

describe('attachBrowserHostSocket', () => {
  it('rejects a wrong token with 4401', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/browser-host?token=wrong`)
    const code = await new Promise<number>((resolve) => socket.once('close', (c) => resolve(c)))
    expect(code).toBe(4401)
  })

  it('a connected host receives calls from the hub', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/browser-host?token=${TOKEN}`)
    await new Promise<void>((resolve) => socket.once('open', () => resolve()))
    const received = new Promise<BrowserCall>((resolve) =>
      socket.once('message', (raw) => resolve(JSON.parse(String(raw)) as BrowserCall)),
    )
    await expect.poll(() => hub.connected()).toBe(true)
    const result = hub.call('b1', 'reload', {})
    const call = await received
    expect(call).toMatchObject({ browserId: 'b1', action: 'reload' })
    socket.send(JSON.stringify({ id: call.id, ok: true, result: 'ok' }))
    expect(await result).toBe('ok')
    socket.close()
  })
})
