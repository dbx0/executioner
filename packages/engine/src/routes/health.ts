import { Hono } from 'hono'

/**
 * Unauthenticated on purpose: a supervisor needs to poll readiness before it
 * has connected. It says nothing else, since any local page can call it.
 */
export function healthRoutes(): Hono {
  const app = new Hono()
  app.get('/health', (c) => c.json({ ok: true }))
  return app
}
