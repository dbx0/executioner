import type { EngineConnection } from './connection.js'

export function ptyUrl(connection: EngineConnection, sessionId: string): string {
  return `ws://127.0.0.1:${connection.port}/pty/${sessionId}?token=${connection.token}`
}
