import { Hono } from 'hono'
import type { Project } from '@exe/project'
import type { NodeRegistry } from '@exe/nodes'
import { toolManifestSchema } from '@exe/protocol'

/**
 * CRUD for the engagement's user-authored tool nodes. A custom node is a full
 * ToolManifest, validated against toolManifestSchema on create/update. Once
 * stored it is merged into GET /api/nodes and the workflow executor, so it
 * appears in the palette and runs like a bundled tool.
 *
 * Mounted under the bearer-guarded /api router.
 */
export function customNodeRoutes(project: Project, registry: NodeRegistry): Hono {
  const app = new Hono()

  app.get('/custom-nodes', (c) => c.json(project.customNodes.list()))

  app.post('/custom-nodes', async (c) => {
    const parsed = toolManifestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid custom node', detail: parsed.error.format() }, 400)
    const id = parsed.data.id
    if (registry.get(id) !== undefined) {
      return c.json({ error: `id "${id}" is already a bundled node; choose a different id` }, 400)
    }
    if (project.customNodes.get(id) !== undefined) {
      return c.json({ error: `custom node "${id}" already exists` }, 409)
    }
    return c.json(project.customNodes.create(parsed.data), 201)
  })

  app.put('/custom-nodes/:id', async (c) => {
    const id = c.req.param('id')
    const parsed = toolManifestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid custom node', detail: parsed.error.format() }, 400)
    // The path id is authoritative; guard against colliding with a bundled node.
    if (parsed.data.id !== id && registry.get(parsed.data.id) !== undefined) {
      return c.json({ error: `id "${parsed.data.id}" is already a bundled node` }, 400)
    }
    const updated = project.customNodes.update(id, parsed.data)
    if (updated === undefined) return c.json({ error: 'not found' }, 404)
    return c.json(updated)
  })

  app.delete('/custom-nodes/:id', (c) => {
    project.customNodes.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  return app
}
