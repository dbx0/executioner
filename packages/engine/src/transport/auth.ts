import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import type { AgentGrant, AgentTokenRegistry } from './agent-tokens.js'

/** 32 random bytes, base64url encoded. Regenerated on every engine launch. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Compare a presented token with the real one in constant time. Both sides are
 * hashed first so the comparison always runs over 32 bytes: `timingSafeEqual`
 * needs equal lengths, and an early return on a length mismatch would tell a
 * caller how long the token is.
 */
export function timingSafeCompare(presented: string, expected: string): boolean {
  if (presented.length === 0 || expected.length === 0) return false
  const left = createHash('sha256').update(presented, 'utf8').digest()
  const right = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(left, right)
}

/** Where a scoped agent token may be used, as `METHOD /full/path` keys. */
export interface AgentAuth {
  registry: AgentTokenRegistry
  routes: ReadonlySet<string>
}

const grants = new WeakMap<Request, AgentGrant>()

/** The scoped grant a request was let in with, or undefined for the master token. */
export function agentGrantOf(c: Context): AgentGrant | undefined {
  return grants.get(c.req.raw)
}

/**
 * The engine listens on loopback only, but any local process could reach it,
 * so every request carries the launch token. With `agents`, a scoped agent
 * token is also accepted, on its listed routes only; elsewhere it gets a 403.
 */
export function bearerAuth(token: string, agents?: AgentAuth): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (timingSafeCompare(presented, token)) {
      await next()
      return
    }
    const grant = agents?.registry.verify(presented)
    if (agents === undefined || grant === undefined) return c.json({ error: 'unauthorised' }, 401)
    if (!agents.routes.has(`${c.req.method} ${c.req.path}`)) return c.json({ error: 'forbidden' }, 403)
    grants.set(c.req.raw, grant)
    await next()
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** The hostname part of a Host header (`127.0.0.1:4100` -> `127.0.0.1`). */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(0, end + 1)
  }
  const colon = host.indexOf(':')
  return (colon === -1 ? host : host.slice(0, colon)).toLowerCase()
}

/**
 * True for a Host header that names this machine's loopback. A page served from
 * an attacker's domain can re-point that domain at 127.0.0.1 (DNS rebinding)
 * and so reach the engine as same-origin; its requests still carry the
 * attacker's hostname, which is what this rejects. A request with no Host at
 * all (an in-process test, a raw socket) is not a browser and passes.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === '') return true
  return LOOPBACK_HOSTS.has(hostnameOf(host))
}

/** Rejects any request whose Host header is not loopback. */
export function loopbackHostOnly(): MiddlewareHandler {
  return async (c, next) => {
    if (!isLoopbackHost(c.req.header('host'))) return c.json({ error: 'forbidden host' }, 403)
    await next()
  }
}

/**
 * The origins allowed to read engine responses from a browser: the packaged
 * renderer (file://, which browsers report as "null") and a renderer served
 * from loopback, which is how the dev server runs. Anything else is a web page
 * the operator happens to have open, and gets no CORS grant.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (origin === 'null' || origin.startsWith('file://')) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * Whether a WebSocket upgrade may proceed: addressed to loopback, and either
 * not from a browser (no Origin) or from one of the app's own origins. The
 * token is still checked afterwards; this stops a web page from even trying.
 */
export function isTrustedUpgrade(headers: { host?: string | undefined; origin?: string | undefined }): boolean {
  if (!isLoopbackHost(headers.host)) return false
  return headers.origin === undefined || isAllowedOrigin(headers.origin)
}
