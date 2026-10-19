import { Hono } from 'hono'
import { z } from 'zod'
import type { Project } from '@exe/project'
import { buildArgv, resolveParams, type NodeRegistry } from '@exe/nodes'
import type { Executor } from '../execution/executor.js'
import { buildManifestMap } from '../infra/manifests.js'
import { manifestOutputs } from '../mcp/node-types.js'
import { launcherForProfile } from '../infra/launcher.js'

const runSchema = z.object({
  nodeId: z.string().min(1),
  targetId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  /** A saved backend profile id, or 'local'/omitted to run on this machine. */
  backendProfileId: z.string().optional(),
})

const previewSchema = z.object({
  /** The target to fill in; without one the command shows a stand-in. */
  targetId: z.string().min(1).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
})

/** What the command shows in place of a target the user has not picked yet. */
export const PREVIEW_TARGET = '<target>'

export function nodeRoutes(project: Project, registry: NodeRegistry, executor: Executor): Hono {
  const app = new Hono()

  // Bundled registry manifests plus the project's user-authored custom nodes,
  // resolved fresh per request so a newly created custom node appears at once.
  app.get('/nodes', (c) =>
    c.json(
      [...buildManifestMap(registry, project).values()].map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        // The binary this node invokes, so a client can tell whether the node
        // is runnable on a given connection without re-deriving the mapping.
        program: m.command.program,
        accepts: m.accepts,
        params: m.params,
        outputs: manifestOutputs(m),
      })),
    ),
  )

  /**
   * The exact argv a run would execute, built by the same code a run uses, so
   * the form can show it before anything starts. A command that cannot be built
   * yet (a param still missing) answers with the reason, not a guess.
   */
  app.post('/nodes/:id/preview', async (c) => {
    const parsed = previewSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request', detail: parsed.error.format() }, 400)

    const manifest = buildManifestMap(registry, project).get(c.req.param('id'))
    if (manifest === undefined) return c.json({ error: 'unknown node' }, 404)

    let target: { value: string; [key: string]: unknown } = { value: PREVIEW_TARGET }
    if (parsed.data.targetId !== undefined) {
      const found = project.targets.get(parsed.data.targetId)
      if (found === undefined) return c.json({ error: 'unknown target' }, 404)
      target = found
    }

    try {
      const params = resolveParams(manifest, parsed.data.params)
      return c.json(buildArgv(manifest, { target, params }))
    } catch (error) {
      return c.json({ error: (error as Error).message }, 422)
    }
  })

  app.post('/executions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = runSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', detail: parsed.error.format() }, 400)
    }

    const manifest = buildManifestMap(registry, project).get(parsed.data.nodeId)
    if (manifest === undefined) return c.json({ error: 'unknown node' }, 404)

    const target = project.targets.get(parsed.data.targetId)
    if (target === undefined) return c.json({ error: 'unknown target' }, 404)

    if (!manifest.accepts.includes(target.kind)) {
      return c.json({ error: `node ${manifest.id} does not accept ${target.kind}` }, 400)
    }

    // Resolved the same way a workflow run resolves it: absent or 'local' runs
    // on this machine, an id we do not know is the caller's mistake.
    const backendProfileId = parsed.data.backendProfileId
    let backendProfile
    if (backendProfileId !== undefined && backendProfileId !== 'local') {
      backendProfile = project.backends.get(backendProfileId)
      if (backendProfile === undefined) return c.json({ error: 'unknown backend profile' }, 400)
    }

    let params
    try {
      params = resolveParams(manifest, parsed.data.params)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }

    // The params are persisted as the caller sent them, not as resolved: a
    // replay must reproduce what the user typed, defaults included by the
    // manifest at run time exactly as they were the first time.
    const { executionId } = executor.start(manifest, target, params, {
      launcher: launcherForProfile(backendProfile),
      ...(backendProfile !== undefined ? { backendProfileId: backendProfile.id } : {}),
      params: parsed.data.params,
    })
    return c.json({ executionId }, 202)
  })

  return app
}
