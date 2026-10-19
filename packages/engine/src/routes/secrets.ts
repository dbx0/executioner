import { Hono } from 'hono'
import { z } from 'zod'
import type { Project } from '@exe/project'

const valueSchema = z.object({ value: z.string() })

/**
 * CRUD for the user's API-key secrets (Shodan, Censys, …). These are USER-level
 * (`~/.executioner/global.sqlite`), so a key entered once is available in every
 * engagement. Mounted under the bearer-guarded /api router.
 *
 * This is a local tool the user controls; GET returns the stored values so the
 * secrets manager UI can display and edit them, matching how backend profiles
 * are exposed.
 */
export function secretRoutes(project: Project): Hono {
  const app = new Hono()

  app.get('/secrets', (c) => c.json(project.secrets.list()))

  app.put('/secrets/:key', async (c) => {
    const key = c.req.param('key').trim()
    if (key === '') return c.json({ error: 'missing key' }, 400)
    const parsed = valueSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'missing value' }, 400)
    return c.json(project.secrets.set(key, parsed.data.value))
  })

  app.delete('/secrets/:key', (c) => {
    project.secrets.remove(c.req.param('key'))
    return c.json({ ok: true })
  })

  return app
}
