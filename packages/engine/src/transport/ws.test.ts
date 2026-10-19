import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { EventBus } from './events.js'
import { attachEventSocket } from './ws.js'

const TOKEN = 'ws-token-ws-token-ws-token-tok'

let http: Server
let bus: EventBus
let port: number

const connect = (query: string): WebSocket =>
  new WebSocket(`ws://127.0.0.1:${port}/events${query}`)

const nextMessage = (socket: WebSocket): Promise<unknown> =>
  new Promise((resolve) => socket.once('message', (raw) => resolve(JSON.parse(String(raw)))))

beforeEach(async () => {
  bus = new EventBus()
  http = createServer()
  attachEventSocket(http, bus, TOKEN)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  port = (http.address() as { port: number }).port
})

afterEach(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()))
})

describe('attachEventSocket', () => {
  it('streams published events to an authorised client', async () => {
    const socket = connect(`?token=${TOKEN}`)
    await new Promise<void>((resolve) => socket.once('open', () => resolve()))

    const received = nextMessage(socket)
    bus.publish({ type: 'stdout', executionId: 'e1', nodeId: 'n1', data: 'hello' })

    expect(await received).toMatchObject({ type: 'stdout', data: 'hello', seq: 1 })
    socket.close()
  })

  it('closes a connection with a bad token', async () => {
    const socket = connect('?token=wrong')
    const code = await new Promise<number>((resolve) => socket.once('close', (c) => resolve(c)))
    expect(code).toBe(4401)
  })

  it('refuses an upgrade from a web page origin, even with the token', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/events?token=${TOKEN}`, { origin: 'https://evil.example' })
    const error = await new Promise<Error>((resolve) => socket.once('error', (e) => resolve(e)))
    expect(error.message).toContain('403')
  })

  it('closes a connection with no token', async () => {
    const socket = connect('')
    const code = await new Promise<number>((resolve) => socket.once('close', (c) => resolve(c)))
    expect(code).toBe(4401)
  })

  it('stops publishing to a client that disconnected', async () => {
    const socket = connect(`?token=${TOKEN}`)
    await new Promise<void>((resolve) => socket.once('open', () => resolve()))
    socket.close()
    await new Promise<void>((resolve) => socket.once('close', () => resolve()))

    expect(() =>
      bus.publish({ type: 'done', executionId: 'e1', nodeId: 'n1', data: '' }),
    ).not.toThrow()
  })
})
