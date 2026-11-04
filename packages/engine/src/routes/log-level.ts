import { Hono } from 'hono'
import { z } from 'zod'
import { isLogLevel } from '@exe/protocol'
import { engineLog } from '../infra/log.js'

const bodySchema = z.object({ level: z.string().refine(isLogLevel) })

/** `PUT /log-level` switches the engine's log verbosity at runtime. Mounted under the bearer-guarded /api router. */
export function logLevelRoutes(): Hono {
  const app = new Hono()

  app.put('/log-level', async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || !isLogLevel(parsed.data.level)) return c.json({ error: 'invalid level' }, 400)
    engineLog.setLevel(parsed.data.level)
    return c.body(null, 204)
  })

  return app
}
