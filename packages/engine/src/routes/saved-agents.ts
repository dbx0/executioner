import { Hono } from 'hono'
import { z } from 'zod'
import type { Project } from '@exe/project'
import type { SavedAgent, SavedAgentInput, SavedAgentMember } from '@exe/db'
import { SavedAgentsStore } from '../agents/saved-agents-store.js'

const memberSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  prompt: z.string().min(1),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
})

const bodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  agent: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  members: z.array(memberSchema).optional(),
  scope: z.enum(['local', 'global']).optional(),
})

/** Normalise a wire member into a clean roster entry (drops empty optionals). */
function toMember(m: z.infer<typeof memberSchema>): SavedAgentMember {
  const out: SavedAgentMember = { name: m.name, description: m.description, prompt: m.prompt }
  if (m.model !== undefined && m.model !== '') out.model = m.model
  if (m.tools !== undefined && m.tools.length > 0) out.tools = m.tools
  return out
}

/** Strip the wire body down to the repository/store input (drops scope). */
function toInput(b: z.infer<typeof bodySchema>): SavedAgentInput {
  return {
    name: b.name,
    ...(b.description === undefined ? {} : { description: b.description }),
    agent: b.agent,
    prompt: b.prompt,
    ...(b.model === undefined ? {} : { model: b.model }),
    ...(b.tools === undefined ? {} : { tools: b.tools }),
    ...(b.members === undefined ? {} : { members: b.members.map(toMember) }),
  }
}

/**
 * Manage the user's saved agents. `local` agents live in the engagement DB;
 * `global` agents live in the user-level `~/.executioner/agents.json` (seeded
 * from the built-in Claude teams on first read). The list merges both, and a
 * PUT that changes the scope MOVES the agent between the two stores.
 *
 * Mounted under the bearer-guarded /api router.
 */
export function savedAgentRoutes(project: Project, store: SavedAgentsStore = new SavedAgentsStore()): Hono {
  const app = new Hono()

  /** Find an agent by id across both stores, returning it with its scope. */
  const locate = (id: string): SavedAgent | undefined => project.savedAgents.get(id) ?? store.get(id)

  app.get('/saved-agents', (c) => {
    // Seeding happens on the store read; a broken global file degrades to [].
    let global: SavedAgent[]
    try {
      global = store.list()
    } catch {
      global = []
    }
    const local = project.savedAgents.list()
    return c.json({ agents: [...local, ...global] })
  })

  app.post('/saved-agents', async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid agent', detail: parsed.error.format() }, 400)
    const input = toInput(parsed.data)
    const created =
      parsed.data.scope === 'local' ? project.savedAgents.create(input) : store.create(input)
    return c.json(created, 201)
  })

  app.put('/saved-agents/:id', async (c) => {
    const id = c.req.param('id')
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid agent', detail: parsed.error.format() }, 400)

    const existing = locate(id)
    if (existing === undefined) return c.json({ error: 'not found' }, 404)

    const input = toInput(parsed.data)
    const targetScope = parsed.data.scope ?? existing.scope

    // Same store: plain update.
    if (targetScope === existing.scope) {
      const updated = existing.scope === 'local' ? project.savedAgents.update(id, input) : store.update(id, input)
      if (updated === undefined) return c.json({ error: 'not found' }, 404)
      return c.json(updated)
    }

    // Scope changed: MOVE — delete from the old store, create in the new one.
    if (existing.scope === 'local') {
      project.savedAgents.remove(id)
      return c.json(store.create(input))
    }
    store.remove(id)
    return c.json(project.savedAgents.create(input))
  })

  app.delete('/saved-agents/:id', (c) => {
    const id = c.req.param('id')
    const existing = locate(id)
    if (existing === undefined) return c.json({ ok: true })
    if (existing.scope === 'local') project.savedAgents.remove(id)
    else store.remove(id)
    return c.json({ ok: true })
  })

  return app
}
