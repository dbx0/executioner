import axios, { type AxiosInstance } from 'axios'

/** Where a live engine listens. v1 host is always 127.0.0.1. */
export interface EngineEndpoint {
  readonly host: string
  readonly port: number
}

export interface EngineConnection {
  readonly endpoint: EngineEndpoint
  readonly token: string
  readonly projectRoot: string
}

/** Compatibility with today's desktop `{ port, token, projectRoot }`. */
export interface LegacyEngineConnection {
  port: number
  token: string
  projectRoot: string
}

export function fromLegacyConnection(legacy: LegacyEngineConnection): EngineConnection {
  return {
    endpoint: { host: '127.0.0.1', port: legacy.port },
    token: legacy.token,
    projectRoot: legacy.projectRoot,
  }
}

export function toLegacyConnection(conn: EngineConnection): LegacyEngineConnection {
  return {
    port: conn.endpoint.port,
    token: conn.token,
    projectRoot: conn.projectRoot,
  }
}

export function createClient(connection: EngineConnection): AxiosInstance {
  const { host, port } = connection.endpoint
  return axios.create({
    baseURL: `http://${host}:${port}/api`,
    headers: { common: { Authorization: `Bearer ${connection.token}` } },
  })
}

export function eventsUrl(connection: EngineConnection): string {
  const { host, port } = connection.endpoint
  return `ws://${host}:${port}/events?token=${connection.token}`
}

export function ptyUrl(connection: EngineConnection, sessionId: string): string {
  const { host, port } = connection.endpoint
  return `ws://${host}:${port}/pty/${sessionId}?token=${connection.token}`
}
