import { Hono } from 'hono'
import { z } from 'zod'
import { graphSchema, validateGraph } from '@exe/graph'
import type { Project } from '@exe/project'
import type { WorkflowSummary } from '@exe/db'

const bodySchema = z.object({ name: z.string().min(1), graph: graphSchema })

/** The wire shape of a listed workflow (snake_case, as the UI reads it). */
function toWire(w: WorkflowSummary): { id: string; name: string; created_at: string; updated_at: string } {
  return { id: w.id, name: w.name, created_at: w.createdAt, updated_at: w.updatedAt }
}

/**
 * CRUD for the user's saved workflows. These are USER-level — one workflow
 * library, the same in every engagement — while the runs a workflow produced
 * belong to the engagement that ran them.
 */
export function workflowRoutes(project: Project): Hono {
  const app = new Hono()

  app.get('/workflows', (c) => c.json(project.workflows.list().map(toWire)))

  app.post('/workflows', async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid workflow' }, 400)
    const validation = validateGraph(parsed.data.graph)
    if (!validation.ok) return c.json({ error: 'invalid graph', detail: validation.errors }, 400)

    const created = project.workflows.create(parsed.data.name, JSON.stringify(parsed.data.graph))
    return c.json({ id: created.id, name: created.name }, 201)
  })

  app.get('/workflows/:id', (c) => {
    const workflow = project.workflows.get(c.req.param('id'))
    if (workflow === undefined) return c.json({ error: 'not found' }, 404)
    return c.json({ id: workflow.id, name: workflow.name, graph: JSON.parse(workflow.graph) })
  })

  app.put('/workflows/:id', async (c) => {
    const id = c.req.param('id')
    if (!project.workflows.exists(id)) return c.json({ error: 'not found' }, 404)

    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid workflow' }, 400)
    const validation = validateGraph(parsed.data.graph)
    if (!validation.ok) return c.json({ error: 'invalid graph', detail: validation.errors }, 400)

    const updated = project.workflows.update(id, parsed.data.name, JSON.stringify(parsed.data.graph))
    if (updated === undefined) return c.json({ error: 'not found' }, 404)
    return c.json({ id: updated.id, name: updated.name })
  })

  app.delete('/workflows/:id', (c) => {
    const id = c.req.param('id')
    if (!project.workflows.exists(id)) return c.json({ error: 'not found' }, 404)

    // The workflow is user-level but its runs and schedules are not, and they
    // are in another database file — so no cascade fires. Clear this
    // engagement's here: drop the runs, or detach them to keep the history.
    // Runs recorded in other engagements keep the id and show it unresolved.
    project.runs.releaseWorkflow(id, c.req.query('keepHistory') === 'true')
    project.schedules.removeForWorkflow(id)
    project.workflows.remove(id)
    return c.json({ ok: true })
  })

  app.post('/workflows/:id/duplicate', (c) => {
    const copy = project.workflows.duplicate(c.req.param('id'))
    if (copy === undefined) return c.json({ error: 'not found' }, 404)
    return c.json({ id: copy.id, name: copy.name }, 201)
  })

  return app
}
