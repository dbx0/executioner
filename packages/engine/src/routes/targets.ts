import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { buildTargetTree } from '@exe/db'
import { targetKindSchema } from '@exe/protocol'
import type { Project } from '@exe/project'
import { confineAbsolute } from '../infra/confine.js'
import type { Target, TargetKind } from '@exe/protocol'

const createTargetSchema = z.object({
  kind: targetKindSchema,
  value: z.string().min(1),
  source: z.string().min(1).default('manual'),
  parentId: z.string().uuid().nullable().optional(),
})

const updateTargetSchema = z
  .object({
    kind: targetKindSchema.optional(),
    value: z.string().min(1).optional(),
  })
  .refine((p) => p.kind !== undefined || p.value !== undefined, { message: 'nothing to update' })

/**
 * @param onCreated Best-effort hook fired when a target is newly created (not on
 *   re-discovery), used to run matching on_create schedules.
 */
export function targetRoutes(project: Project, onCreated?: (target: Target) => void): Hono {
  const app = new Hono()

  app.get('/targets', (c) => c.json(project.targets.all()))

  app.get('/targets/tree', (c) => c.json(buildTargetTree(project.targets.all())))

  app.get('/targets/:id', (c) => {
    const target = project.targets.get(c.req.param('id'))
    if (target === undefined) return c.json({ error: 'not found' }, 404)
    return c.json({
      ...target,
      facts: project.facts.forTarget(target.id),
      findings: project.findings.forTarget(target.id),
    })
  })

  app.get('/targets/:id/screenshots', (c) => {
    const id = c.req.param('id')
    if (project.targets.get(id) === undefined) return c.json({ error: 'not found' }, 404)

    const mimeByExt: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }

    const items: Array<{
      factId: string
      nodeId: string | null
      executionId: string | null
      collectedAt: string
      url?: string
      dataUrl: string
    }> = []

    for (const fact of project.facts.forTarget(id, 'screenshot')) {
      const data = fact.data
      const rawPath = data.path
      if (typeof rawPath !== 'string' || rawPath.length === 0) continue
      // The path comes from a fact, which tool output and agents can write, so
      // it is only read when it lies inside this engagement (its evidence).
      const resolved = confineAbsolute(project.root, rawPath)
      if (resolved === null || !existsSync(resolved) || !statSync(resolved).isFile()) continue
      const mime = mimeByExt[path.extname(resolved).toLowerCase()] ?? 'image/png'
      const dataUrl = `data:${mime};base64,${readFileSync(resolved).toString('base64')}`
      const item: {
        factId: string
        nodeId: string | null
        executionId: string | null
        collectedAt: string
        url?: string
        dataUrl: string
      } = {
        factId: fact.id,
        nodeId: fact.nodeId,
        executionId: fact.executionId,
        collectedAt: fact.collectedAt,
        dataUrl,
      }
      if (typeof data.url === 'string') item.url = data.url
      items.push(item)
    }

    return c.json(items)
  })

  app.post('/targets', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = createTargetSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid target', detail: parsed.error.format() }, 400)
    }

    const existed = project.targets.findByValue(parsed.data.kind, parsed.data.value) !== undefined

    // The repository refuses a value the tree cannot store — a wildcard, a
    // malformed address, a url with no scheme — and its message says what to do
    // instead. Letting that throw escape turned "*.bmw.com" into a 500 with
    // nothing to act on.
    let target
    try {
      target = project.targets.upsert({
        kind: parsed.data.kind,
        value: parsed.data.value,
        source: parsed.data.source,
        parentId: parsed.data.parentId ?? null,
      })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }

    if (!existed) onCreated?.(target)

    return c.json(target, existed ? 200 : 201)
  })

  app.patch('/targets/:id', async (c) => {
    const parsed = updateTargetSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid update', detail: parsed.error.format() }, 400)
    const patch: { kind?: TargetKind; value?: string } = {}
    if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind
    if (parsed.data.value !== undefined) patch.value = parsed.data.value
    try {
      const updated = project.targets.update(c.req.param('id'), patch)
      if (updated === undefined) return c.json({ error: 'not found' }, 404)
      return c.json(updated)
    } catch (e) {
      // A collision is a conflict with something that exists; anything else is
      // a value that could never be stored, which is the caller's mistake.
      const message = (e as Error).message
      return c.json({ error: message }, message.includes('already exists') ? 409 : 400)
    }
  })

  app.delete('/targets/:id', (c) => {
    const removed = project.targets.removeSubtree(c.req.param('id'))
    if (removed === 0) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true, removed })
  })

  return app
}
