import { Hono } from 'hono'
import { z } from 'zod'
import { targetKindSchema } from '@exe/protocol'
import type { Project } from '@exe/project'

const scheduleInputSchema = z
  .object({
    workflowId: z.string().min(1),
    targetId: z.string().min(1).nullable().optional(),
    kind: z.enum(['interval', 'on_create']),
    intervalSeconds: z.number().int().positive().nullable().optional(),
    targetKind: targetKindSchema.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.kind !== 'interval' || (v.intervalSeconds ?? 0) > 0, {
    message: 'interval schedules require a positive intervalSeconds',
  })
  .refine((v) => v.kind !== 'on_create' || v.targetKind != null, {
    message: 'on_create schedules require a targetKind',
  })

const patchSchema = z.object({ enabled: z.boolean() })

/**
 * CRUD for the engagement's workflow schedules (interval / on_create triggers).
 * Mounted under the bearer-guarded /api router. Creating or removing a schedule
 * refreshes the running Scheduler so timers reflect the current rows.
 */
export function scheduleRoutes(project: Project, onChange?: () => void): Hono {
  const app = new Hono()

  app.get('/schedules', (c) => c.json(project.schedules.list()))

  app.post('/schedules', async (c) => {
    const parsed = scheduleInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid schedule', detail: parsed.error.format() }, 400)
    if (!project.workflows.exists(parsed.data.workflowId)) {
      return c.json({ error: 'unknown workflow' }, 400)
    }
    const created = project.schedules.create(parsed.data)
    onChange?.()
    return c.json(created, 201)
  })

  app.patch('/schedules/:id', async (c) => {
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid patch', detail: parsed.error.format() }, 400)
    const updated = project.schedules.setEnabled(c.req.param('id'), parsed.data.enabled)
    if (updated === undefined) return c.json({ error: 'not found' }, 404)
    onChange?.()
    return c.json(updated)
  })

  app.delete('/schedules/:id', (c) => {
    project.schedules.remove(c.req.param('id'))
    onChange?.()
    return c.json({ ok: true })
  })

  return app
}
