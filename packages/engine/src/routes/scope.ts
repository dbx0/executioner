import { Hono } from 'hono'
import { z } from 'zod'
import { newId } from '@exe/protocol'
import type { Project } from '@exe/project'
import type { EventBus } from '../transport/events.js'
import { AgentScopeRunner } from '../agents/agent-scope-runner.js'

/** Builds the LLM step for a scope run (claude + MCP), or undefined when no
 *  capable agent is available — in which case the run adds nothing (AI-only, no
 *  regex fallback). Injected by the server. */
export type RunAgentFactory = (
  agent: string,
  runId: string,
) => ((input: { scope: string; description: string; runId: string }) => Promise<void>) | undefined

export interface ScopeRouteDeps {
  project: Project
  bus: EventBus
  buildRunAgent?: RunAgentFactory
}

const body = z.object({
  scope: z.string().min(1),
  agent: z.string().min(1).optional(),
  /** The operator's raw program notes; the agent tidies them into HUNT.md. */
  description: z.string().optional(),
})

/**
 * `POST /scope/parse` kicks off a "Start with AI" scope parse. It returns a
 * `runId` immediately (202) and runs detached: progress streams over the events
 * WebSocket as `agent` events keyed by that runId (`scope-progress` bubbles and a
 * final `scope-done`), and the resulting targets land in the project's target
 * tree. The client reads the summary from the `scope-done` bubble and refreshes
 * the target tree.
 */
export function scopeRoutes(deps: ScopeRouteDeps): Hono {
  const app = new Hono()

  app.post('/scope/parse', async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request', detail: parsed.error.format() }, 400)

    const runId = newId()
    const agent = parsed.data.agent ?? 'claude'
    const runAgent = deps.buildRunAgent?.(agent, runId)
    const runner = new AgentScopeRunner({
      bus: deps.bus,
      project: deps.project,
      cwd: deps.project.root,
      ...(runAgent !== undefined ? { runAgent } : {}),
    })

    // Fire and forget: the client streams progress over /events and reads the
    // final summary from the scope-done bubble + the refreshed targets tree.
    const description = parsed.data.description ?? ''
    void runner.run({ scope: parsed.data.scope, description, runId }).catch(() => {
      deps.bus.publish({ type: 'agent', executionId: runId, nodeId: 'scope-done', data: JSON.stringify({ error: true }) })
    })

    return c.json({ runId }, 202)
  })

  return app
}
