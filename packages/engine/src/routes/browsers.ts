import { Hono } from 'hono'
import type { BrowserHostHub } from '../browser/host-hub.js'
import type { BrowserRegistry } from '../browser/registry.js'

interface CreateBody {
  id?: string
  url?: string
  title?: string
}

interface AnswerBody {
  reply?: unknown
}

interface PatchBody {
  owner?: string | null
  url?: string
  title?: string
}

export function browserRoutes(registry: BrowserRegistry, hub: BrowserHostHub): Hono {
  const app = new Hono()

  app.get('/browsers', (c) => c.json(registry.list()))

  app.post('/browsers', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as CreateBody
    const existing = body.id !== undefined ? registry.get(body.id) : undefined
    if (existing !== undefined) return c.json(existing)
    return c.json(
      registry.create({
        ...(body.id !== undefined ? { id: body.id } : {}),
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
      }),
    )
  })

  app.patch('/browsers/:id', async (c) => {
    const id = c.req.param('id')
    if (registry.get(id) === undefined) return c.json({ error: 'unknown browser' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as PatchBody
    registry.update(id, {
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
    })
    if (body.owner !== undefined) registry.setOwner(id, body.owner)
    return c.json(registry.get(id))
  })

  /** The operator is done with what the agent asked for; unblocks its browser_ask_operator call. */
  app.post('/browsers/:id/answer', async (c) => {
    const id = c.req.param('id')
    if (registry.get(id) === undefined) return c.json({ error: 'unknown browser' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as AnswerBody
    const reply = typeof body.reply === 'string' && body.reply !== '' ? body.reply : undefined
    if (!registry.answer(id, reply)) return c.json({ error: 'nothing pending' }, 409)
    return c.body(null, 204)
  })

  app.delete('/browsers/:id', (c) => {
    const id = c.req.param('id')
    registry.remove(id)
    if (hub.connected()) void hub.call(id, 'close', {}).catch(() => undefined)
    return c.body(null, 204)
  })

  return app
}
