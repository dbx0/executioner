import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { isTrustedUpgrade, timingSafeCompare } from '../transport/auth.js'
import type { BrowserHostHub } from './host-hub.js'

/**
 * The desktop main process connects here to host the embedded browsers. Same
 * trust and token check as /events, and the same noServer + path-scoped upgrade
 * so it coexists with the other sockets.
 */
export function attachBrowserHostSocket(http: Server, hub: BrowserHostHub, token: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/browser-host') return

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
      hub.attach(ws as WebSocket)
    })
  })

  return wss
}
