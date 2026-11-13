import { Hono } from 'hono'
import { z } from 'zod'
import { targetKindSchema } from '@exe/protocol'
import type { Project } from '@exe/project'

/**
 * The built-in nodes that make sense run alone against a target, so an action
 * may name one the way it names a tool. Flow nodes (if, loop, save) and nodes
 * that need a hand-written body (http_request, python_script) are not here.
 */
export const STANDALONE_BUILTIN_NODES = ['tls_cert', 'dns_records', 'asn', 'cloud_buckets', 'screenshot', 'geoip', 'shodan', 'censys'] as const

export interface ActionRouteDeps {
  project: Project
  /** Every node type an action may run on its own: the tools plus the built-in recon nodes. */
  nodeTypes: () => Set<string>
  /** Called after any change, so the running Scheduler re-reads its timers. */
  onChange?: () => void
}

/** Where an action lives: shared by every engagement, or this one's own. */
const scopeSchema = z.enum(['default', 'engagement'])

const actionInputSchema = z.object({
  scope: scopeSchema,
  kind: z.enum(['interval', 'on_create']),
  intervalSeconds: z.number().int().positive().nullable().optional(),
  targetKind: targetKindSchema.nullable().optional(),
  targetId: z.string().min(1).nullable().optional(),
  workflowId: z.string().min(1).nullable().optional(),
  nodeType: z.string().min(1).nullable().optional(),
  nodeParams: z.record(z.string(), z.unknown()).nullable().optional(),
  /** A saved backend profile id to run on, or null/omitted for the engagement default. */
  backendProfileId: z.string().min(1).nullable().optional(),
  inScopeOnly: z.boolean().optional(),
})

type ActionInput = z.infer<typeof actionInputSchema>

/** Why an otherwise well-formed action cannot be saved, or null when it can. */
function problemWith(input: ActionInput, deps: ActionRouteDeps): string | null {
  const { project } = deps
  const runsWorkflow = input.workflowId != null
  const runsNode = input.nodeType != null
  if (runsWorkflow === runsNode) return 'an action runs either a workflow or a tool'
  if (runsWorkflow && !project.workflows.exists(input.workflowId as string)) return 'unknown workflow'
  if (runsNode && !deps.nodeTypes().has(input.nodeType as string)) return 'unknown tool'

  if (input.kind === 'on_create' && input.targetKind == null) return 'pick the kind of target that triggers this action'
  if (input.kind === 'interval') {
    if ((input.intervalSeconds ?? 0) <= 0) return 'a scheduled action needs how often it runs'
    // A timer has no target of its own to hand over, and a default has no
    // engagement to find one in.
    if (input.scope === 'default') return 'a scheduled action belongs to one engagement'
    if (runsNode && input.targetId == null) return 'a scheduled tool needs a target to run against'
    if (input.targetId != null && project.targets.get(input.targetId) === undefined) return 'unknown target'
  }

  // Caught here, not only when the action eventually fires, so the operator
  // learns about a dangling connection while they can still fix it.
  const backend = input.backendProfileId
  if (backend != null && backend !== 'local' && project.backends.get(backend) === undefined) return 'unknown backend profile'
  return null
}

const patchSchema = z.object({ enabled: z.boolean() })

/**
 * The Actions page's API: what the system does on its own. An action is a
 * trigger (a timer, or a kind of target being added) and what it runs (a
 * workflow, or one tool). Defaults are shared by every engagement and kept in
 * the user-level database; switching one here is this engagement's own choice
 * and leaves it as it was everywhere else.
 */
export function actionRoutes(deps: ActionRouteDeps): Hono {
  const { project } = deps
  const app = new Hono()

  app.get('/actions', (c) =>
    c.json({
      defaults: project.defaultActions.list().map((action) => ({
        ...action,
        enabledHere: project.defaultOverrides.get(action.id) ?? action.enabled,
      })),
      engagement: project.schedules.list(),
    }),
  )

  app.post('/actions', async (c) => {
    const parsed = actionInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid action', detail: parsed.error.format() }, 400)
    const problem = problemWith(parsed.data, deps)
    if (problem !== null) return c.json({ error: problem }, 400)

    const { scope, ...input } = parsed.data
    const isTimer = input.kind === 'interval'
    const created = (scope === 'default' ? project.defaultActions : project.schedules).create({
      ...input,
      // Each trigger keeps only the fields that mean something for it.
      targetId: isTimer ? (input.targetId ?? null) : null,
      targetKind: isTimer ? null : (input.targetKind ?? null),
      intervalSeconds: isTimer ? (input.intervalSeconds ?? null) : null,
      inScopeOnly: !isTimer && input.inScopeOnly === true,
    })
    deps.onChange?.()
    return c.json(created, 201)
  })

  app.patch('/actions/:scope/:id', async (c) => {
    const scope = scopeSchema.safeParse(c.req.param('scope'))
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!scope.success || !parsed.success) return c.json({ error: 'invalid patch' }, 400)
    const id = c.req.param('id')

    if (scope.data === 'default') {
      const action = project.defaultActions.get(id)
      if (action === undefined) return c.json({ error: 'not found' }, 404)
      project.defaultOverrides.set(id, parsed.data.enabled)
      deps.onChange?.()
      return c.json({ ...action, enabledHere: parsed.data.enabled })
    }

    const updated = project.schedules.setEnabled(id, parsed.data.enabled)
    if (updated === undefined) return c.json({ error: 'not found' }, 404)
    deps.onChange?.()
    return c.json(updated)
  })

  app.delete('/actions/:scope/:id', (c) => {
    const scope = scopeSchema.safeParse(c.req.param('scope'))
    if (!scope.success) return c.json({ error: 'invalid scope' }, 400)
    const id = c.req.param('id')
    if (scope.data === 'default') {
      project.defaultActions.remove(id)
      project.defaultOverrides.clear(id)
    } else {
      project.schedules.remove(id)
    }
    deps.onChange?.()
    return c.json({ ok: true })
  })

  return app
}
