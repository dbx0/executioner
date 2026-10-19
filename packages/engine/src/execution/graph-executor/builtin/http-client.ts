import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import type { Readable, Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { bareHostname, BlockedRequestError, vetDestination, type GuardOptions, type ResolvedAddress } from './http-guard.js'

/** Bodies past this size are refused rather than held in memory. */
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
export const DEFAULT_MAX_REDIRECTS = 5

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
/** Headers that carry the caller's identity, dropped when a redirect leaves the origin. */
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'host']

/** One hop on the wire: the url, and the vetted address the connection must use. */
export interface WireRequest {
  url: URL
  pinned: ResolvedAddress
  method: string
  headers: Record<string, string>
  body: string | undefined
  signal: AbortSignal
}

export interface WireResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Readable
}

/** Sends one request without following redirects. Injected in tests. */
export type Sender = (req: WireRequest) => Promise<WireResponse>

/**
 * A lookup that ignores the name it is asked about and answers with the address
 * already vetted, so the socket connects there and nowhere else. TLS still sees
 * the hostname, so SNI and certificate checks are unchanged.
 */
export function pinnedLookup(pinned: ResolvedAddress): LookupFunction {
  return ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (options.all === true) callback(null, [{ address: pinned.address, family: pinned.family }])
    else callback(null, pinned.address, pinned.family)
  }) as unknown as LookupFunction
}

export const nodeSender: Sender = (req) =>
  new Promise((resolve, reject) => {
    const send = req.url.protocol === 'https:' ? httpsRequest : httpRequest
    const outgoing = send(
      {
        protocol: req.url.protocol,
        hostname: bareHostname(req.url),
        port: req.url.port === '' ? undefined : Number(req.url.port),
        path: `${req.url.pathname}${req.url.search}`,
        method: req.method,
        headers: req.headers,
        lookup: pinnedLookup(req.pinned),
        // No pooling: a kept-alive socket would outlive the vetting of its address.
        agent: false,
        signal: req.signal,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    )
    outgoing.on('error', reject)
    outgoing.end(req.body)
  })

/** Parses a url, refusing every scheme but http and https. */
export function parseHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`invalid url: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedRequestError(`blocked: only http and https URLs are allowed, not ${url.protocol}`)
  }
  return url
}

function decoderFor(encoding: string): Transform | null {
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip()
  if (encoding === 'deflate') return createInflate()
  if (encoding === 'br') return createBrotliDecompress()
  return null
}

/**
 * Reads a response body, decoded, up to `maxBytes`. The cap counts decoded
 * bytes, so a small compressed body that inflates past it is refused too.
 */
async function readCapped(res: WireResponse, maxBytes: number): Promise<Buffer> {
  const decoder = decoderFor(String(res.headers['content-encoding'] ?? '').trim().toLowerCase())
  if (decoder !== null) res.body.on('error', (e) => decoder.destroy(e))
  const source = decoder === null ? res.body : res.body.pipe(decoder)
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      total += chunk.length
      if (total > maxBytes) {
        throw new Error(`response is larger than ${String(maxBytes)} bytes; refused`)
      }
      chunks.push(chunk)
    }
  } finally {
    res.body.destroy()
  }
  return Buffer.concat(chunks)
}

/** Rejects when the signal fires first, so a slow DNS answer counts against the timeout. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason as Error)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export interface GuardedRequestInput {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | undefined
  timeoutMs: number
  maxBytes?: number
  maxRedirects?: number
  guard: GuardOptions
  /** A refusal reason when the url, or the address it resolved to, is out of scope. */
  judgeScope?: (url: URL, address: string) => string | null
  /** Absent → a real socket through node:http(s). */
  send?: Sender | undefined
}

export interface GuardedResponse {
  status: number
  ok: boolean
  text: string
  /** The url that answered, after any redirects. */
  url: string
}

/**
 * Sends an HTTP request the way the http_request node may: http(s) only, every
 * hop's address vetted and pinned, redirects followed by hand up to a cap, the
 * body capped, and one deadline over the whole exchange.
 */
export async function guardedRequest(input: GuardedRequestInput): Promise<GuardedResponse> {
  const send = input.send ?? nodeSender
  const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const signal = AbortSignal.timeout(input.timeoutMs)

  let url = parseHttpUrl(input.url)
  let method = input.method
  let body = input.body
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers)) headers[name.toLowerCase()] = value
  // Credentials in the url become a header, so a cross-origin redirect drops them like any other.
  if (url.username !== '' && headers.authorization === undefined) {
    const user = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
    headers.authorization = `Basic ${Buffer.from(user).toString('base64')}`
  }
  url.username = ''
  url.password = ''

  try {
    for (let hop = 0; ; hop += 1) {
      const pinned = await abortable(vetDestination(url, input.guard), signal)
      const outOfScope = input.judgeScope?.(url, pinned.address) ?? null
      if (outOfScope !== null) throw new BlockedRequestError(outOfScope)

      const res = await send({ url, pinned, method, headers, body, signal })
      const location = res.headers.location
      if (!REDIRECT_STATUSES.has(res.status) || typeof location !== 'string' || location === '') {
        const text = (await readCapped(res, input.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES)).toString('utf8')
        return { status: res.status, ok: res.status >= 200 && res.status < 300, text, url: url.toString() }
      }

      res.body.destroy()
      if (hop >= maxRedirects) throw new Error(`stopped after ${String(maxRedirects)} redirects (last went to ${location})`)
      let next: URL
      try {
        next = parseHttpUrl(new URL(location, url).toString())
      } catch (e) {
        if (e instanceof BlockedRequestError) throw new BlockedRequestError(`${e.message} (redirected from ${url.toString()})`)
        throw new Error(`redirect to an invalid url: ${location}`, { cause: e })
      }
      next.username = ''
      next.password = ''
      if (next.origin !== url.origin) for (const name of CREDENTIAL_HEADERS) delete headers[name]
      // As browsers do: 303, and 301/302 after a POST, continue as a bodiless GET.
      if ((res.status === 303 && method !== 'HEAD') || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
        delete headers['content-type']
        delete headers['content-length']
      }
      url = next
    }
  } catch (e) {
    if (signal.aborted && !(e instanceof BlockedRequestError)) {
      throw new Error(`timed out after ${String(input.timeoutMs)} ms`, { cause: e })
    }
    throw e
  }
}
