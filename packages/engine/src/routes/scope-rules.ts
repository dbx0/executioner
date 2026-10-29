import { Hono } from 'hono'
import { z } from 'zod'
import { scopeEffectSchema } from '@exe/protocol'
import type { Project } from '@exe/project'

const createSchema = z.object({
  effect: scopeEffectSchema,
  pattern: z.string().min(1),
  note: z.string().optional(),
  source: z.string().min(1).optional(),
})

const updateSchema = z
  .object({
    effect: scopeEffectSchema.optional(),
    pattern: z.string().min(1).optional(),
    note: z.string().optional(),
  })
  .refine((p) => p.effect !== undefined || p.pattern !== undefined || p.note !== undefined, {
    message: 'nothing to update',
  })

/**
 * CRUD over the engagement's boundary.
 *
 * Every write re-judges the whole target tree and says how many verdicts moved.
 * A boundary that only governed future writes would be the situation this
 * replaces: an operator adds the exclusion that rules a host out, and the host
 * sits in the tree still looking legitimate.
 */
export function scopeRuleRoutes(project: Project): Hono {
  const app = new Hono()

  /** Re-judge the tree and report how many verdicts moved and where the tree now stands. */
  const rejudge = (): { rejudged: number; inScope: number; outOfScope: number } => {
    const rejudged = project.targets.reevaluateScope()
    const { inScope, outOfScope } = project.targets.scopeCounts()
    return { rejudged, inScope, outOfScope }
  }

  app.get('/scope/rules', (c) => c.json(project.scopeRules.all()))

  app.post('/scope/rules', async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid scope rule', detail: parsed.error.format() }, 400)
    }

    try {
      const rule = project.scopeRules.add({
        effect: parsed.data.effect,
        pattern: parsed.data.pattern,
        ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
        source: parsed.data.source ?? 'manual',
      })
      return c.json({ rule, ...rejudge() }, 201)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  app.patch('/scope/rules/:id', async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid update', detail: parsed.error.format() }, 400)
    }

    try {
      const rule = project.scopeRules.update(c.req.param('id'), {
        ...(parsed.data.effect === undefined ? {} : { effect: parsed.data.effect }),
        ...(parsed.data.pattern === undefined ? {} : { pattern: parsed.data.pattern }),
        ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
      })
      if (rule === undefined) return c.json({ error: 'not found' }, 404)
      return c.json({ rule, ...rejudge() })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409)
    }
  })

  app.delete('/scope/rules/:id', (c) => {
    if (!project.scopeRules.remove(c.req.param('id'))) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, ...rejudge() })
  })

  app.post('/scope/reevaluate', (c) => c.json({ ...rejudge() }))

  return app
}
