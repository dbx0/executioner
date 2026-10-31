import { describe, expect, it } from 'vitest'
import { NetworkLog } from './network-log'

const sent = (requestId: string, url: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  timestamp: 10,
  type: 'XHR',
  request: { method: 'GET', url, headers: { Accept: '*/*' } },
  ...extra,
})

describe('NetworkLog', () => {
  it('records a request and its response', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('1', 'http://x/a', { request: { method: 'POST', url: 'http://x/a', headers: { A: 'b' }, postData: 'hi' } }), 'S1')
    log.responseReceived({ requestId: '1', type: 'Fetch', response: { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/plain' }, mimeType: 'text/plain' } })
    log.loadingFinished({ requestId: '1', timestamp: 10.25 })
    const { entries, next } = log.since()
    expect(next).toBe(1)
    expect(entries).toEqual([
      expect.objectContaining({
        seq: 1,
        requestId: '1',
        sessionId: 'S1',
        method: 'POST',
        url: 'http://x/a',
        requestHeaders: { A: 'b' },
        postData: 'hi',
        status: 200,
        statusText: 'OK',
        mimeType: 'text/plain',
        responseHeaders: { 'Content-Type': 'text/plain' },
        durationMs: 250,
      }),
    ])
  })

  it('records a failure', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('1', 'http://x/a'))
    log.loadingFailed({ requestId: '1', timestamp: 11, errorText: 'net::ERR_FAILED' })
    expect(log.since().entries[0]).toMatchObject({ failed: 'net::ERR_FAILED', durationMs: 1000 })
  })

  it('a redirect opens a new entry', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('1', 'http://x/a'))
    log.requestWillBeSent(sent('1', 'http://x/b', { timestamp: 10.5, redirectResponse: { status: 302, headers: { Location: '/b' } } }))
    const { entries } = log.since()
    expect(entries.map((e) => [e.seq, e.url, e.status])).toEqual([
      [1, 'http://x/a', 302],
      [2, 'http://x/b', undefined],
    ])
    log.responseReceived({ requestId: '1', response: { status: 200, headers: {} } })
    expect(log.find('1')?.url).toBe('http://x/b')
    const after = log.since().entries
    expect(after[0]?.status).toBe(302)
    expect(after[1]?.status).toBe(200)
  })

  it('filters by url and limits', () => {
    const log = new NetworkLog()
    for (const n of [1, 2, 3, 4]) log.requestWillBeSent(sent(String(n), n % 2 ? `http://x/odd${n}` : `http://x/even${n}`))
    expect(log.since(0, { urlContains: 'odd' }).entries.map((e) => e.seq)).toEqual([1, 3])
    const page = log.since(0, { limit: 2 })
    expect(page.entries.map((e) => e.seq)).toEqual([1, 2])
    expect(page.next).toBe(2)
    expect(log.since(page.next).entries.map((e) => e.seq)).toEqual([3, 4])
  })

  it('drops the oldest past the cap', () => {
    const log = new NetworkLog(3)
    for (const n of [1, 2, 3, 4, 5]) log.requestWillBeSent(sent(String(n), `http://x/${n}`))
    expect(log.since().entries.map((e) => e.requestId)).toEqual(['3', '4', '5'])
    expect(log.find('1')).toBeUndefined()
    expect(log.find('5')).toBeDefined()
  })

  it('truncates large post data', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('1', 'http://x/a', { request: { method: 'POST', url: 'http://x/a', headers: {}, postData: 'a'.repeat(70 * 1024) } }))
    const entry = log.since().entries[0]
    expect(entry?.postData).toHaveLength(64 * 1024)
    expect(entry?.postDataTruncated).toBe(true)
  })

  describe('wire headers', () => {
    it('ExtraInfo after the request fills sentHeaders next to the page headers', () => {
      const log = new NetworkLog()
      log.requestWillBeSent(sent('1', 'http://x/a', { request: { method: 'GET', url: 'http://x/a', headers: { 'X-Remove-Me': '1' } } }))
      log.requestWillBeSentExtraInfo({ requestId: '1', headers: { 'X-Exec-Test': 'yes', 'Accept-Language': 'en-US', Cookie: 'a=b' } })
      log.responseReceivedExtraInfo({ requestId: '1', headers: { 'Set-Cookie': 'c=d' }, statusCode: 200 })
      expect(log.find('1')).toMatchObject({
        requestHeaders: { 'X-Remove-Me': '1' },
        sentHeaders: { 'X-Exec-Test': 'yes', 'Accept-Language': 'en-US', Cookie: 'a=b' },
        receivedHeaders: { 'Set-Cookie': 'c=d' },
      })
    })

    it('ExtraInfo before the request is buffered until it arrives', () => {
      const log = new NetworkLog()
      log.requestWillBeSentExtraInfo({ requestId: '1', headers: { A: 'wire' } })
      log.requestWillBeSent(sent('1', 'http://x/a'))
      expect(log.find('1')?.sentHeaders).toEqual({ A: 'wire' })
    })

    it('each redirect hop gets its own wire headers', () => {
      const log = new NetworkLog()
      log.requestWillBeSent(sent('1', 'http://x/a'))
      log.requestWillBeSentExtraInfo({ requestId: '1', headers: { Hop: '1' } })
      // The second hop's ExtraInfo can arrive before its requestWillBeSent.
      log.requestWillBeSentExtraInfo({ requestId: '1', headers: { Hop: '2' } })
      log.requestWillBeSent(sent('1', 'http://x/b', { redirectResponse: { status: 302, headers: {} } }))
      expect(log.since().entries.map((e) => e.sentHeaders)).toEqual([{ Hop: '1' }, { Hop: '2' }])
    })

    it('the buffer is bounded', () => {
      const log = new NetworkLog(1000, 2)
      for (const n of [1, 2, 3]) log.requestWillBeSentExtraInfo({ requestId: String(n), headers: { N: String(n) } })
      for (const n of [1, 2, 3]) log.requestWillBeSent(sent(String(n), `http://x/${n}`))
      expect(log.since().entries.map((e) => e.sentHeaders)).toEqual([undefined, { N: '2' }, { N: '3' }])
    })

    it('records the headers a rewrite rule produced', () => {
      const log = new NetworkLog()
      log.requestWillBeSent(sent('1', 'http://x/a'))
      log.markRewritten('1', 'r1', [{ name: 'X-Exec-Test', value: 'yes' }])
      expect(log.find('1')).toMatchObject({ rewrittenBy: 'r1', rewrittenHeaders: { 'X-Exec-Test': 'yes' } })
    })
  })
})
