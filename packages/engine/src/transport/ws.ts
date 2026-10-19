import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { isTrustedUpgrade, timingSafeCompare } from './auth.js'
import type { EventBus } from './events.js'

/**
 * Bridges /events to the engine event bus. The launch token travels as a query
 * parameter because browser WebSocket clients cannot set an Authorization
 * header (safe here: loopback-bound, per-launch token).
 *
 * Uses noServer + a path-scoped upgrade handler so it coexists with the /pty
 * socket. A WebSocketServer bound with `{ server, path }` would instead claim
 * every upgrade and 400 any other path, which would break /pty.
 */
export function attachEventSocket(http: Server, bus: EventBus, token: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/events') return // let other upgrade handlers (e.g. /pty) run

    if (!isTrustedUpgrade(request.headers)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const presented = url.searchParams.get('token') ?? ''
      if (!timingSafeCompare(presented, token)) {
        ws.close(4401, 'unauthorised')
        return
      }
      bind(ws as WebSocket, bus)
    })
  })

  return wss
}

function bind(socket: WebSocket, bus: EventBus): void {
  const unsubscribe = bus.subscribe((event) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event))
  })
  socket.on('close', unsubscribe)
  socket.on('error', unsubscribe)
}
