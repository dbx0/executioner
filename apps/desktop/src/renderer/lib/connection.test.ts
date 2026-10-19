import { describe, expect, it } from 'vitest'
import { createClient, eventsUrl } from './connection.js'

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
