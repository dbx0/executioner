import type { MiddlewareHandler } from 'hono'
import { routePath } from 'hono/route'
import { engineLog } from '../infra/log.js'

/**
 * One log line per request: method, route pattern (`/api/workflows/:id`, never
 * the concrete path, its query or its body), status and duration. A server
 * error is a warn at any verbosity; everything else is debug only.
 */
export function requestLog(): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now()
    await next()
    const status = c.res.status
    const lvl = status >= 500 ? 'warn' : 'debug'
    if (lvl === 'debug' && engineLog.level() !== 'debug') return
    // After next() the route index points at the handler that answered.
    const data = { method: c.req.method, route: routePath(c), status, ms: Math.round(performance.now() - started) }
    engineLog[lvl]('http', 'Request', data)
  }
}
