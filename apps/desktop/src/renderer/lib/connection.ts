import axios, { type AxiosInstance } from 'axios'
import { rlog } from './log.js'

export interface EngineConnection {
  port: number
  token: string
  projectRoot: string
}

export function createClient(connection: EngineConnection): AxiosInstance {
  const client = axios.create({
    baseURL: `http://127.0.0.1:${connection.port}/api`,
    headers: { common: { Authorization: `Bearer ${connection.token}` } },
  })
  client.interceptors.response.use(undefined, (error: unknown) => {
    logRequestFailure(error)
    return Promise.reject(error)
  })
  return client
}

/**
 * Give every failed engine call a log line, since many callers fall back
 * quietly. A server error is a warn; a refused input or an unreachable engine
 * (restarting, or the engagement closing) is expected and debug only. The
 * endpoint is logged without its query, and never a body.
 */
export function logRequestFailure(error: unknown): void {
  if (axios.isCancel(error) || !axios.isAxiosError(error)) return
  const endpoint = (error.config?.url ?? '').split('?')[0]
  const data = {
    method: (error.config?.method ?? 'get').toUpperCase(),
    endpoint,
    ...(error.response !== undefined ? { status: error.response.status } : { code: error.code ?? 'NETWORK' }),
  }
  if (error.response !== undefined && error.response.status >= 500) rlog.warn('api', 'Engine request failed', data)
  else rlog.debug('api', 'Engine request failed', data)
}

export function eventsUrl(connection: EngineConnection): string {
  return `ws://127.0.0.1:${connection.port}/events?token=${connection.token}`
}
