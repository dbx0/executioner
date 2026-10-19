import { Hono } from 'hono'
import { z } from 'zod'
import type { Project } from '@exe/project'
import { FINDING_STATUSES, SEVERITIES, type FindingFilter, type FindingInput } from '@exe/db'
import { writeFindingsReport } from '../infra/findings-report.js'

const severity = z.enum(SEVERITIES)
const status = z.enum(FINDING_STATUSES)

const createSchema = z.object({
  title: z.string().min(1),
  severity,
  status: status.optional(),
  description: z.string().optional(),
  details: z.string().optional(),
  targetId: z.string().min(1).nullable().optional(),
})

/** Every field optional: a PATCH edits only what it names. */
const updateSchema = z.object({
  title: z.string().min(1).optional(),
  severity: severity.optional(),
  status: status.optional(),
  description: z.string().optional(),
  details: z.string().optional(),
  targetId: z.string().min(1).nullable().optional(),
})

/** An empty query value means "no filter", as the page sends it. */
const optionalQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional())

/** The list filters, shared by the listing and the report so both mean the same thing. */
const filterSchema = z.object({
  status: optionalQuery(status),
  severity: optionalQuery(severity),
  targetId: optionalQuery(z.string()),
})

/** A parsed filter with its absent keys dropped, as the repository takes it. */
function toFilter(query: z.infer<typeof filterSchema>): FindingFilter {
  return {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.severity === undefined ? {} : { severity: query.severity }),
    ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
  }
}

/**
 * Drop the keys a request did not send, so a PATCH that names three fields
 * edits three fields (the schema types them as present-but-undefined).
 */
function toInput(body: Partial<Record<keyof FindingInput, unknown>>): Partial<FindingInput> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) out[key] = value
  }
  return out as Partial<FindingInput>
}

/**
 * The engagement's findings: what the work proved, as opposed to what it ran.
 * Workflows write here through the `save_to_finding` node and agents through the
 * MCP tools; these routes back the Findings page — reading, hand-writing one,
 * triaging it, and deleting it.
 *
 * Mounted under the bearer-guarded /api router.
 */
export function findingRoutes(project: Project): Hono {
  const app = new Hono()

  app.get('/findings', (c) => {
    const parsed = filterSchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid filter' }, 400)
    return c.json(project.findings.list(toFilter(parsed.data)))
  })

  /**
   * Write the findings out as a Markdown report under `<root>/reports/`. Takes
   * the same filters as the list, so what you exported is what you were looking
   * at, and says so in the file.
   */
  app.post('/findings/report', (c) => {
    const parsed = filterSchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid filter' }, 400)
    const filter = toFilter(parsed.data)
    const note = Object.entries(filter)
      .map(([k, v]) => `${k} = ${String(v)}`)
      .join(', ')
    try {
      const written = writeFindingsReport(project, project.findings.list(filter), {
        ...(note === '' ? {} : { filterNote: note }),
      })
      return c.json(written)
    } catch (e) {
      // The fs error names absolute paths; the operator sees it in the engine log.
      process.stderr.write(`[executioner] findings report failed: ${(e as Error).message}\n`)
      return c.json({ error: 'could not write the report' }, 500)
    }
  })

  app.get('/findings/:id', (c) => {
    const finding = project.findings.get(c.req.param('id'))
    if (finding === undefined) return c.json({ error: 'not found' }, 404)
    return c.json(finding)
  })

  app.post('/findings', async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid finding', detail: parsed.error.format() }, 400)
    // A finding typed on this page is the user's own; the node and the MCP tool
    // set their own source.
    return c.json(project.findings.create({ ...toInput(parsed.data), source: 'manual' } as FindingInput), 201)
  })

  app.patch('/findings/:id', async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid finding', detail: parsed.error.format() }, 400)
    const updated = project.findings.update(c.req.param('id'), toInput(parsed.data))
    if (updated === undefined) return c.json({ error: 'not found' }, 404)
    return c.json(updated)
  })

  app.delete('/findings/:id', (c) => {
    const id = c.req.param('id')
    if (project.findings.get(id) === undefined) return c.json({ error: 'not found' }, 404)
    project.findings.remove(id)
    return c.json({ ok: true })
  })

  return app
}
