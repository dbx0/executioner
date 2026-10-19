import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { PtyRegistry } from '@exe/pty'
import { isTrustedUpgrade, timingSafeCompare } from './auth.js'

type PtySession = NonNullable<ReturnType<PtyRegistry['get']>>

/**
 * Bridges /pty/:id to a PTY session. Engine output goes out as text frames;
 * client keystrokes come in as text frames; a JSON { resize: { cols, rows } }
 * frame resizes the tty. Token travels in the query, as with /events.
 */
export function attachPtySocket(http: Server, registry: PtyRegistry, token: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/pty/')) return // let other upgrade handlers (e.g. /events) run

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
      const id = url.pathname.slice('/pty/'.length)
      const session = registry.get(id)
      if (session === undefined) {
        ws.close(4404, 'no such session')
        return
      }
      bind(ws, session)
    })
  })

  return wss
}

function bind(ws: WebSocket, session: PtySession): void {
  // Replay what the session has already printed, then subscribe — both in one
  // synchronous block so no output can slip between the snapshot and the live
  // stream. Without the replay a client that attaches to a running session
  // (the desktop remounts a terminal on every engagement switch) starts blank
  // and shows only what the process prints next.
  const backlog = session.snapshot()
  if (backlog !== '' && ws.readyState === ws.OPEN) ws.send(backlog)
  const subscription = session.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data)
  })
  // Drop the listener with the socket, or each re-attach leaks one against a
  // session that may outlive many of them.
  ws.on('close', () => subscription.dispose())
  session.onExit(() => ws.close())

  ws.on('message', (raw) => {
    const text = String(raw)
    if (text.startsWith('{')) {
      try {
        const control = JSON.parse(text) as { resize?: { cols?: unknown; rows?: unknown } } | null
        const resize = control?.resize
        if (resize !== undefined) {
          // A tty cannot take a fractional, negative or absurd size; node-pty
          // throws on some of those, so anything else is dropped.
          const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 10_000
          if (valid(resize.cols) && valid(resize.rows)) session.resize(resize.cols, resize.rows)
          return
        }
      } catch {
        // not a control frame, treat as input below
      }
    }
    session.write(text)
  })
}
