import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScopeRule } from '@exe/protocol'
import {
  guardedRequest,
  parseHttpUrl,
  pinnedLookup,
  type GuardedRequestInput,
  type Sender,
  type WireRequest,
} from './graph-executor/builtin/http-client.js'
import { BlockedRequestError, internalAddressClass, type Resolver } from './graph-executor/builtin/http-guard.js'
import { buildRequestBody, buildRequestHeaders, outOfScopeReason } from './graph-executor/builtin/http.js'

/** A resolver answering from a fixed table, counting how often it is asked. */
function tableResolver(table: Record<string, string[]>): Resolver & { calls: string[] } {
  const calls: string[] = []
  const resolve = (async (host: string) => {
    calls.push(host)
    const found = table[host]
    if (found === undefined) throw new Error('ENOTFOUND')
    return found.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }) as Resolver & { calls: string[] }
  resolve.calls = calls
  return resolve
}

/** A sender answering from a script of responses, recording every request. */
function scriptedSender(
  respond: (req: WireRequest) => { status: number; headers?: Record<string, string>; body?: Buffer | string },
): Sender & { sent: WireRequest[] } {
  const sent: WireRequest[] = []
  const send = (async (req: WireRequest) => {
    sent.push({ ...req, headers: { ...req.headers } })
    const r = respond(req)
    return { status: r.status, headers: r.headers ?? {}, body: Readable.from([Buffer.from(r.body ?? '')]) }
  }) as Sender & { sent: WireRequest[] }
  send.sent = sent
  return send
}

const PUBLIC = '93.184.216.34'

function request(overrides: Partial<GuardedRequestInput>): Promise<Awaited<ReturnType<typeof guardedRequest>>> {
  return guardedRequest({
    url: 'http://public.test/',
    method: 'GET',
    headers: {},
    timeoutMs: 5000,
    guard: { allowInternal: false, resolve: tableResolver({ 'public.test': [PUBLIC] }) },
    send: scriptedSender(() => ({ status: 200, body: 'ok' })),
    ...overrides,
  })
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
})

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return (server.address() as AddressInfo).port
}

describe('internalAddressClass', () => {
  const internal: Array<[string, string]> = [
    ['0.0.0.0', 'unspecified'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.100.100.200', 'carrier-grade NAT'],
    ['169.254.169.254', 'link-local'],
    ['192.0.0.192', 'reserved'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fe80::1%eth0', 'link-local'],
    ['fec0::1', 'site-local'],
    ['fc00::1', 'unique local'],
    ['fd00:ec2::254', 'unique local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-embedded loopback'],
    ['::ffff:7f00:1', 'IPv4-embedded loopback'],
    ['::ffff:169.254.169.254', 'IPv4-embedded link-local'],
    ['::ffff:a9fe:a9fe', 'IPv4-embedded link-local'],
    ['::ffff:10.0.0.1', 'IPv4-embedded private'],
    ['::127.0.0.1', 'IPv4-embedded loopback'],
    ['64:ff9b::a9fe:a9fe', 'IPv4-embedded link-local'],
    ['2002:7f00:1::', 'IPv4-embedded loopback'],
  ]
  for (const [address, cls] of internal) {
    it(`flags ${address} as ${cls}`, () => {
      expect(internalAddressClass(address)).toContain(cls)
    })
  }

  for (const address of ['8.8.8.8', '172.32.0.1', '100.128.0.1', PUBLIC, '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    it(`lets public ${address} through`, () => {
      expect(internalAddressClass(address)).toBeNull()
    })
  }
})

describe('guardedRequest: destinations', () => {
  const spellings = [
    'http://2130706433/',
    'http://0x7f.1/',
    'http://0x7f000001/',
    'http://017700000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[fd00:ec2::254]/',
    'http://0.0.0.0:8080/',
  ]
  for (const url of spellings) {
    it(`refuses ${url} without sending anything`, async () => {
      const resolve = tableResolver({})
      const send = scriptedSender(() => ({ status: 200 }))
      await expect(request({ url, guard: { allowInternal: false, resolve }, send })).rejects.toThrow(BlockedRequestError)
      expect(resolve.calls).toEqual([])
      expect(send.sent).toHaveLength(0)
    })
  }

  it('judges the address a hostname resolves to, and names the opt-in', async () => {
    const send = scriptedSender(() => ({ status: 200 }))
    const err = await request({
      url: 'http://metadata.google.internal/computeMetadata/v1/',
      guard: { allowInternal: false, resolve: tableResolver({ 'metadata.google.internal': ['169.254.169.254'] }) },
      send,
    }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(BlockedRequestError)
    expect((err as Error).message).toContain('metadata.google.internal (169.254.169.254) is a link-local')
    expect((err as Error).message).toContain('Allow internal addresses')
    expect((err as Error).message).not.toContain('—')
    expect(send.sent).toHaveLength(0)
  })

  it('refuses a hostname resolving to 127.0.0.1', async () => {
    await expect(
      request({ url: 'http://localtest.test/', guard: { allowInternal: false, resolve: tableResolver({ 'localtest.test': ['127.0.0.1'] }) } }),
    ).rejects.toThrow(/loopback/)
  })

  it('refuses a name that answers with one public and one private address', async () => {
    await expect(
      request({ url: 'http://mixed.test/', guard: { allowInternal: false, resolve: tableResolver({ 'mixed.test': [PUBLIC, '10.0.0.7'] }) } }),
    ).rejects.toThrow(/private/)
  })

  it('sends a public destination, pinned to the address it vetted', async () => {
    const send = scriptedSender(() => ({ status: 200, body: '{"ok":1}' }))
    const res = await request({ send })
    expect(res).toMatchObject({ status: 200, ok: true, text: '{"ok":1}' })
    expect(send.sent[0]?.pinned).toEqual({ address: PUBLIC, family: 4 })
  })

  it('reaches internal addresses with the opt-in, but never the engine port', async () => {
    const guard = { allowInternal: true, enginePort: 4555, resolve: tableResolver({ 'localhost.test': ['::1'] }) }
    await expect(request({ url: 'http://10.0.0.5/', guard })).resolves.toMatchObject({ status: 200 })
    await expect(request({ url: 'http://127.0.0.1:8080/', guard })).resolves.toMatchObject({ status: 200 })
    await expect(request({ url: 'http://127.0.0.1:4555/api/secrets', guard })).rejects.toThrow(/engine's own API/)
    await expect(request({ url: 'http://[::ffff:127.0.0.1]:4555/', guard })).rejects.toThrow(/engine's own API/)
    await expect(request({ url: 'http://0.0.0.0:4555/', guard })).rejects.toThrow(/engine's own API/)
    await expect(request({ url: 'http://localhost.test:4555/', guard })).rejects.toThrow(/engine's own API/)
  })

  for (const url of ['file:///etc/passwd', 'data:text/plain,hi', 'ftp://example.com/', 'gopher://example.com/', 'javascript:alert(1)']) {
    it(`refuses the ${new URL(url).protocol} scheme`, async () => {
      const send = scriptedSender(() => ({ status: 200 }))
      await expect(request({ url, send })).rejects.toThrow(/only http and https/)
      expect(send.sent).toHaveLength(0)
    })
  }

  it('reports an unparseable url plainly', () => {
    expect(() => parseHttpUrl('not a url')).toThrow('invalid url: not a url')
  })
})

describe('guardedRequest: redirects', () => {
  it('re-vets every hop, so a redirect to metadata is refused', async () => {
    const send = scriptedSender((req) =>
      req.url.hostname === 'public.test'
        ? { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }
        : { status: 200, body: 'creds' },
    )
    await expect(request({ send })).rejects.toThrow(/169\.254\.169\.254 is a link-local/)
    expect(send.sent).toHaveLength(1)
  })

  it('with the opt-in, follows a redirect inward but never to the engine port', async () => {
    const guard = { allowInternal: true, enginePort: 4555, resolve: tableResolver({ 'public.test': [PUBLIC] }) }
    const inward = scriptedSender((req) =>
      req.url.hostname === 'public.test' ? { status: 302, headers: { location: 'http://10.0.0.5/admin' } } : { status: 200, body: 'in' },
    )
    await expect(request({ guard, send: inward })).resolves.toMatchObject({ text: 'in', url: 'http://10.0.0.5/admin' })

    const toEngine = scriptedSender((req) =>
      req.url.hostname === 'public.test' ? { status: 307, headers: { location: 'http://127.0.0.1:4555/api/secrets' } } : { status: 200 },
    )
    await expect(request({ guard, send: toEngine })).rejects.toThrow(/engine's own API/)
    expect(toEngine.sent).toHaveLength(1)
  })

  it('refuses a redirect to a non-http scheme', async () => {
    const send = scriptedSender(() => ({ status: 301, headers: { location: 'file:///etc/passwd' } }))
    await expect(request({ send })).rejects.toThrow(/only http and https URLs are allowed, not file:/)
  })

  it('stops after five redirects', async () => {
    const send = scriptedSender(() => ({ status: 302, headers: { location: '/again' } }))
    await expect(request({ send })).rejects.toThrow(/stopped after 5 redirects/)
    expect(send.sent).toHaveLength(6)
  })

  it('drops credentials when a redirect leaves the origin, and keeps them within it', async () => {
    const resolve = tableResolver({ 'public.test': [PUBLIC], 'other.test': ['198.51.100.7'] })
    const send = scriptedSender((req) => {
      if (req.url.pathname === '/start') return { status: 302, headers: { location: '/same' } }
      if (req.url.pathname === '/same') return { status: 302, headers: { location: 'http://other.test/away' } }
      return { status: 200 }
    })
    await request({
      url: 'http://public.test/start',
      headers: { Authorization: 'Bearer s3cret', Cookie: 'sid=1', 'X-Trace': 't' },
      guard: { allowInternal: false, resolve },
      send,
    })
    expect(send.sent[1]?.headers.authorization).toBe('Bearer s3cret')
    expect(send.sent[2]?.headers.authorization).toBeUndefined()
    expect(send.sent[2]?.headers.cookie).toBeUndefined()
    expect(send.sent[2]?.headers['x-trace']).toBe('t')
  })

  it('turns url credentials into a header that a cross-origin redirect drops', async () => {
    const resolve = tableResolver({ 'public.test': [PUBLIC], 'other.test': ['198.51.100.7'] })
    const send = scriptedSender((req) =>
      req.url.hostname === 'public.test' ? { status: 302, headers: { location: 'http://other.test/' } } : { status: 200 },
    )
    await request({ url: 'http://user:pa%3Ass@public.test/', guard: { allowInternal: false, resolve }, send })
    expect(send.sent[0]?.headers.authorization).toBe(`Basic ${Buffer.from('user:pa:ss').toString('base64')}`)
    expect(send.sent[0]?.url.username).toBe('')
    expect(send.sent[1]?.headers.authorization).toBeUndefined()
  })

  it('continues a 303 as a bodiless GET', async () => {
    const send = scriptedSender((req) => (req.url.pathname === '/' ? { status: 303, headers: { location: '/done' } } : { status: 200 }))
    await request({ method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' }, send })
    expect(send.sent[1]).toMatchObject({ method: 'GET', body: undefined })
    expect(send.sent[1]?.headers['content-type']).toBeUndefined()
  })
})

describe('guardedRequest: limits', () => {
  it('refuses a body larger than the cap', async () => {
    const send = scriptedSender(() => ({ status: 200, body: Buffer.alloc(2048, 'a') }))
    await expect(request({ send, maxBytes: 1024 })).rejects.toThrow('response is larger than 1024 bytes; refused')
  })

  it('counts decoded bytes, so a compressed bomb is refused too', async () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024))
    const send = scriptedSender(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, body: bomb }))
    expect(bomb.length).toBeLessThan(64 * 1024)
    await expect(request({ send, maxBytes: 64 * 1024 })).rejects.toThrow(/larger than 65536 bytes/)
  })

  it('decodes a gzip body within the cap', async () => {
    const send = scriptedSender(() => ({ status: 200, headers: { 'content-encoding': 'gzip' }, body: gzipSync('hello') }))
    await expect(request({ send })).resolves.toMatchObject({ text: 'hello' })
  })

  it('times out a server that never answers', async () => {
    const port = await listen(() => {
      /* never respond */
    })
    await expect(
      request({ url: `http://127.0.0.1:${String(port)}/`, timeoutMs: 200, guard: { allowInternal: true, resolve: tableResolver({}) }, send: undefined }),
    ).rejects.toThrow('timed out after 200 ms')
  })

  it('times out a resolver that never answers', async () => {
    const resolve: Resolver = () => new Promise(() => {})
    await expect(request({ timeoutMs: 100, guard: { allowInternal: false, resolve } })).rejects.toThrow('timed out after 100 ms')
  })

  it('caps a real streamed response', async () => {
    const port = await listen((_req, res) => {
      res.write(Buffer.alloc(600 * 1024))
      res.end(Buffer.alloc(600 * 1024))
    })
    await expect(
      request({
        url: `http://127.0.0.1:${String(port)}/`,
        maxBytes: 1024 * 1024,
        guard: { allowInternal: true, resolve: tableResolver({}) },
        send: undefined,
      }),
    ).rejects.toThrow(/larger than/)
  })
})

describe('guardedRequest: DNS rebinding', () => {
  it('pins the lookup the socket uses to the vetted address', () => {
    const lookup = pinnedLookup({ address: '203.0.113.9', family: 4 }) as unknown as (
      h: string,
      o: { all?: boolean },
      cb: (...args: unknown[]) => void,
    ) => void
    const single: unknown[] = []
    lookup('anything.test', {}, (...args) => single.push(...args))
    expect(single).toEqual([null, '203.0.113.9', 4])
    const all: unknown[] = []
    lookup('anything.test', { all: true }, (...args) => all.push(...args))
    expect(all).toEqual([null, [{ address: '203.0.113.9', family: 4 }]])
  })

  it('connects to the address it vetted, even when a second lookup would say otherwise', async () => {
    let hits = 0
    const port = await listen((_req, res) => {
      hits += 1
      res.end('rebound')
    })
    // The first answer is public; any later one points at this machine.
    let asked = 0
    const resolve: Resolver = async () => {
      asked += 1
      return [{ address: asked === 1 ? '203.0.113.10' : '127.0.0.1', family: 4 }]
    }
    await expect(
      request({ url: `http://rebind.test:${String(port)}/`, timeoutMs: 500, guard: { allowInternal: false, resolve }, send: undefined }),
    ).rejects.toThrow()
    expect(asked).toBe(1)
    expect(hits).toBe(0)
  })

  it('really connects to the pinned address for a name the system cannot resolve', async () => {
    const port = await listen((_req, res) => res.end('pinned'))
    const res = await request({
      url: `http://service.invalid:${String(port)}/`,
      guard: { allowInternal: true, resolve: tableResolver({ 'service.invalid': ['127.0.0.1'] }) },
      send: undefined,
    })
    expect(res.text).toBe('pinned')
  })
})

describe('http_request templating', () => {
  const ctx = { vars: { name: 'x","admin":true,"y":"', n: 7, crlf: 'a\r\nX-Injected: 1', tok: 'abc' } }

  it('JSON-escapes values substituted into a JSON body', () => {
    const body = buildRequestBody('{"user":"{{ vars.name }}","n":{{ vars.n }}}', 'json', ctx)
    expect(JSON.parse(body)).toEqual({ user: 'x","admin":true,"y":"', n: 7 })
  })

  it('percent-encodes values substituted into a form body', () => {
    const body = buildRequestBody('user={{ vars.name }}&role=user', 'form', { vars: { name: 'a&role=admin' } })
    expect(new URLSearchParams(body).getAll('role')).toEqual(['user'])
    expect(new URLSearchParams(body).get('user')).toBe('a&role=admin')
  })

  it('leaves a raw body as written', () => {
    expect(buildRequestBody('{{ vars.name }}', 'raw', ctx)).toBe('x","admin":true,"y":"')
  })

  it('resolves placeholders in header values', () => {
    expect(buildRequestHeaders('{"Authorization":"Bearer {{ vars.tok }}"}', ctx)).toEqual({ authorization: 'Bearer abc' })
  })

  it('refuses a header value that would inject another header', () => {
    expect(() => buildRequestHeaders('{"X-A":"{{ vars.crlf }}"}', ctx)).toThrow(/line break or NUL/)
    expect(() => buildRequestHeaders('{"X-A":"a\\r\\nB: 1"}', {})).toThrow(/line break or NUL/)
    expect(() => buildRequestHeaders('{"X-A\\r\\nB":"1"}', {})).toThrow(/not a valid HTTP header name/)
  })

  it('ignores malformed headers as before', () => {
    expect(buildRequestHeaders('{not json', ctx)).toEqual({})
  })
})

describe('http_request scope rules', () => {
  const rules: ScopeRule[] = [
    { id: 'r1', effect: 'include', pattern: '*.example.com', note: '' },
    { id: 'r2', effect: 'exclude', pattern: 'admin.example.com', note: 'production' },
    { id: 'r3', effect: 'exclude', pattern: '198.51.100.0/24', note: '' },
  ]

  it('refuses a host the scope rules exclude', () => {
    expect(outOfScopeReason(new URL('https://admin.example.com/x'), PUBLIC, rules)).toMatch(
      /out of the engagement's scope \(excluded by admin\.example\.com \(production\)\)/,
    )
  })

  it('refuses an address inside an excluded network', () => {
    expect(outOfScopeReason(new URL('https://www.example.com/'), '198.51.100.20', rules)).toMatch(/198\.51\.100\.20 is out/)
  })

  it('lets in-scope and unlisted hosts through', () => {
    expect(outOfScopeReason(new URL('https://www.example.com/'), PUBLIC, rules)).toBeNull()
    expect(outOfScopeReason(new URL('https://unlisted.test/'), PUBLIC, rules)).toBeNull()
    expect(outOfScopeReason(new URL('https://admin.example.com/'), PUBLIC, [])).toBeNull()
  })

  it('applies to every hop of a redirect', async () => {
    const send = scriptedSender((req) =>
      req.url.hostname === 'public.test' ? { status: 302, headers: { location: 'https://admin.example.com/' } } : { status: 200 },
    )
    const resolve = tableResolver({ 'public.test': [PUBLIC], 'admin.example.com': [PUBLIC] })
    await expect(
      request({ send, guard: { allowInternal: false, resolve }, judgeScope: (url, address) => outOfScopeReason(url, address, rules) }),
    ).rejects.toThrow(/out of the engagement's scope/)
    expect(send.sent).toHaveLength(1)
  })
})
