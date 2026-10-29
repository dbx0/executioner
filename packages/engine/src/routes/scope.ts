import { Hono } from 'hono'
import { z } from 'zod'
import {
  canonicaliseAsset,
  isCanonicalAsset,
  newId,
  scopeEffectSchema,
  scopePatternProblem,
  targetKindSchema,
} from '@exe/protocol'
import { atomically, normaliseScopePattern } from '@exe/db'
import type { Project } from '@exe/project'
import type { EventBus } from '../transport/events.js'
import { AgentScopeRunner } from '../agents/agent-scope-runner.js'
import type { ToolsetDeps } from '../mcp/toolset.js'

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
  /** The shared MCP toolset deps, where a propose-mode parse binds its draft. */
  toolsetDeps?: ToolsetDeps
}

const body = z.object({
  scope: z.string().min(1),
  agent: z.string().min(1).optional(),
  /** The operator's raw program notes; the agent tidies them into HUNT.md. */
  description: z.string().optional(),
  /** Collect the rules and targets for review instead of writing them. */
  propose: z.boolean().optional(),
})

const applyBody = z.object({
  rules: z.array(z.object({ effect: scopeEffectSchema, pattern: z.string().min(1), note: z.string().optional() })),
  targets: z.array(z.object({ kind: targetKindSchema, value: z.string().min(1) })),
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
      ...(deps.toolsetDeps !== undefined ? { toolsetDeps: deps.toolsetDeps } : {}),
      ...(runAgent !== undefined ? { runAgent } : {}),
    })

    // Fire and forget: the client streams progress over /events and reads the
    // final summary from the scope-done bubble + the refreshed targets tree.
    const description = parsed.data.description ?? ''
    void runner.run({ scope: parsed.data.scope, description, runId, propose: parsed.data.propose === true }).catch(() => {
      deps.bus.publish({ type: 'agent', executionId: runId, nodeId: 'scope-done', data: JSON.stringify({ error: true }) })
    })

    return c.json({ runId }, 202)
  })

  /**
   * `POST /scope/apply` saves what a propose-mode parse collected: the rules
   * first, then the targets, then one re-judge of the whole tree. Everything is
   * validated before the first write, and the writes share one transaction, so
   * a bad draft or a failed write saves nothing.
   */
  app.post('/scope/apply', async (c) => {
    const parsed = applyBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request', detail: parsed.error.format() }, 400)
    const { rules, targets } = parsed.data
    const { project } = deps

    for (const rule of rules) {
      const problem = scopePatternProblem(normaliseScopePattern(rule.pattern))
      if (problem !== null) return c.json({ error: problem }, 400)
    }
    for (const target of targets) {
      const asset = canonicaliseAsset(target)
      if (!isCanonicalAsset(asset)) return c.json({ error: asset.error }, 400)
    }

    // One transaction, so a write that fails part way leaves no half-applied scope.
    let saved: { rulesAdded: number; targetsAdded: number; rejudged: number }
    try {
      saved = atomically(project.db, () => {
        const rulesBefore = project.scopeRules.all().length
        for (const rule of rules) {
          project.scopeRules.add({
            effect: rule.effect,
            pattern: rule.pattern,
            ...(rule.note === undefined ? {} : { note: rule.note }),
            source: 'agent',
          })
        }
        const rulesAdded = project.scopeRules.all().length - rulesBefore

        let targetsAdded = 0
        for (const target of targets) {
          const existed = project.targets.findByValue(target.kind, target.value) !== undefined
          project.targets.upsert({ kind: target.kind, value: target.value, source: 'agent' })
          if (!existed) targetsAdded++
        }

        return { rulesAdded, targetsAdded, rejudged: project.targets.reevaluateScope() }
      })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
    const { rulesAdded, targetsAdded, rejudged } = saved
    const { inScope, outOfScope } = project.targets.scopeCounts()
    return c.json({ rulesAdded, targetsAdded, rejudged, inScope, outOfScope })
  })

  return app
}
