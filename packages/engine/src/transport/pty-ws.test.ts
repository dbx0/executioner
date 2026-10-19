import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PtyRegistry } from '@exe/pty'
import { attachPtySocket } from './pty-ws.js'

const TOKEN = 'pty-token-pty-token-pty-token-tok'
let http: Server
let registry: PtyRegistry
let port: number

beforeEach(async () => {
  registry = new PtyRegistry()
  http = createServer()
  attachPtySocket(http, registry, TOKEN)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  port = (http.address() as { port: number }).port
})

afterEach(async () => {
  registry.killAll()
  await new Promise<void>((resolve) => http.close(() => resolve()))
})

// No test here waits on wall-clock time: under a full-suite load node can take
// seconds to start. Children also stay alive until afterEach kills them, since a
// child that exits right after printing can lose that output (node-pty drains
// the pty for only 200 ms after exit) and its session leaves the registry,
// which would turn a late attach into a 4404.

const connect = (id: string, token: string) =>
  new WebSocket(`ws://127.0.0.1:${port}/pty/${id}?token=${token}`)

describe('attachPtySocket', () => {
  it('streams pty output to an authorised client', async () => {
    registry.create('s1', {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("hello-pty"); setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
    })
    const socket = connect('s1', TOKEN)
    const data = await new Promise<string>((resolve) => {
      let buf = ''
      socket.on('message', (m) => {
        buf += String(m)
        if (buf.includes('hello-pty')) resolve(buf)
      })
    })
    expect(data).toContain('hello-pty')
    socket.close()
  }, 15000)

  it('replays what the session already printed to a client that attaches later', async () => {
    // The desktop unmounts a terminal when its engagement tab is switched away
    // from and remounts it on return. Without a replay that reattach showed a
    // blank screen and only whatever the process printed next.
    const session = registry.create('s3', {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("earlier-output"); setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
    })
    // Attach only once the output has been produced and recorded: the session
    // records before any listener added here, so seeing it means the tail has it.
    await new Promise<void>((resolve) => {
      let buf = ''
      const sub = session.onData((d) => {
        buf += d
        if (!buf.includes('earlier-output')) return
        sub.dispose()
        resolve()
      })
    })

    const socket = connect('s3', TOKEN)
    const first = await new Promise<string>((resolve) => {
      socket.on('message', (m) => resolve(String(m)))
    })

    expect(first).toContain('earlier-output')
    socket.close()
  }, 15000)

  it('survives repeated attach/detach cycles against one long-lived session', async () => {
    // One cycle per engagement switch. Disposal itself is asserted in
    // PtySession's own tests; this covers the socket lifecycle end to end.
    registry.create('s4', {
      command: process.execPath,
      args: ['-e', 'setInterval(()=>process.stdout.write("tick "),50)'],
      cwd: process.cwd(),
    })
    const session = registry.get('s4')!

    for (let i = 0; i < 5; i += 1) {
      const socket = connect('s4', TOKEN)
      await new Promise<void>((resolve) => socket.on('open', () => resolve()))
      await new Promise<void>((resolve) => {
        socket.close()
        socket.on('close', () => resolve())
      })
    }

    // A sixth attach still receives live output and a populated replay tail.
    const socket = connect('s4', TOKEN)
    const got = await new Promise<string>((resolve) => {
      let buf = ''
      socket.on('message', (m) => {
        buf += String(m)
        if (buf.includes('tick')) resolve(buf)
      })
    })
    expect(got).toContain('tick')
    expect(session.snapshot()).toContain('tick')
    socket.close()
  }, 20000)

  it('closes with 4401 for a bad token', async () => {
    registry.create('s2', { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: process.cwd() })
    const socket = connect('s2', 'wrong')
    const code = await new Promise<number>((resolve) => socket.on('close', (c) => resolve(c)))
    expect(code).toBe(4401)
  }, 10000)

  it('closes with 4404 for an unknown session id', async () => {
    const socket = connect('ghost', TOKEN)
    const code = await new Promise<number>((resolve) => socket.on('close', (c) => resolve(c)))
    expect(code).toBe(4404)
  }, 10000)
})
