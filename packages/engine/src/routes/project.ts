import { Hono } from 'hono'
import { z } from 'zod'
import { readConfig, writeConfig, type Project } from '@exe/project'

const patchBody = z.object({
  name: z.string().min(1).optional(),
  // An empty string clears the icon; a non-empty string sets it.
  icon: z.string().optional(),
  // The engagement default backend profile id for MCP/scheduled runs. An empty
  // string clears it (back to local); a non-empty string sets it.
  defaultBackendProfileId: z.string().optional(),
})

/**
 * Read and edit the engagement's own metadata (`.executioner/config.json`): its
 * display name and optional emoji icon. Backs the New-engagement modal's icon
 * persistence and the later name/icon editing UI.
 */
export function projectRoutes(project: Project): Hono {
  const app = new Hono()

  app.get('/project', (c) => {
    const config = readConfig(project.root)
    return c.json({
      root: project.root,
      name: config.name,
      icon: config.icon ?? null,
      defaultBackendProfileId: config.defaultBackendProfileId ?? null,
    })
  })

  app.patch('/project', async (c) => {
    const parsed = patchBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request', detail: parsed.error.format() }, 400)

    const backend = parsed.data.defaultBackendProfileId
    if (backend !== undefined && backend !== '' && backend !== 'local' && project.backends.get(backend) === undefined) {
      return c.json({ error: 'unknown backend profile' }, 400)
    }

    const current = readConfig(project.root)
    const next = { ...current }
    if (parsed.data.name !== undefined) next.name = parsed.data.name
    if (parsed.data.icon !== undefined) {
      if (parsed.data.icon === '') delete next.icon
      else next.icon = parsed.data.icon
    }
    if (backend !== undefined) {
      if (backend === '' || backend === 'local') delete next.defaultBackendProfileId
      else next.defaultBackendProfileId = backend
      // Update the in-memory config too, so MCP and scheduled runs in this same
      // session fall back to the new default without waiting for a reopen.
      project.config.defaultBackendProfileId = next.defaultBackendProfileId
    }
    writeConfig(project.root, next)
    return c.json({
      root: project.root,
      name: next.name,
      icon: next.icon ?? null,
      defaultBackendProfileId: next.defaultBackendProfileId ?? null,
    })
  })

  return app
}
