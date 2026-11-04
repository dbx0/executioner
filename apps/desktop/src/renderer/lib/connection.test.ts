import { describe, expect, it, vi } from 'vitest'
import { createClient, eventsUrl, logRequestFailure } from './connection.js'

const connection = { port: 5000, token: 'abc', projectRoot: '/tmp/x' }

describe('createClient', () => {
  it('builds an axios client with the loopback base and bearer token', () => {
    const client = createClient(connection)
    expect(client.defaults.baseURL).toBe('http://127.0.0.1:5000/api')
    expect(client.defaults.headers.common.Authorization).toBe('Bearer abc')
  })
})

describe('eventsUrl', () => {
  it('builds the websocket url with the token in the query', () => {
    expect(eventsUrl(connection)).toBe('ws://127.0.0.1:5000/events?token=abc')
  })
})

describe('logRequestFailure', () => {
  const failure = (status?: number) =>
    Object.assign(new Error('x'), {
      isAxiosError: true,
      config: { method: 'get', url: '/files?path=/home/someone/engagement/notes.md' },
      ...(status !== undefined ? { response: { status } } : { code: 'ERR_NETWORK' }),
    })

  it('logs a server error at warn without the query', async () => {
    const log = await import('./log.js')
    const warn = vi.spyOn(log.rlog, 'warn').mockImplementation(() => {})
    const debug = vi.spyOn(log.rlog, 'debug').mockImplementation(() => {})
    logRequestFailure(failure(500))
    expect(warn).toHaveBeenCalledWith('api', 'Engine request failed', { method: 'GET', endpoint: '/files', status: 500 })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('someone')
    logRequestFailure(failure(404))
    logRequestFailure(failure())
    expect(debug).toHaveBeenCalledTimes(2)
    expect(debug).toHaveBeenLastCalledWith('api', 'Engine request failed', { method: 'GET', endpoint: '/files', code: 'ERR_NETWORK' })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
