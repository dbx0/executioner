import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { z } from 'zod'
import { graphSchema } from '@exe/graph'
import type { Project } from '@exe/project'
import type { NodeRegistry } from '@exe/nodes'
import type { CancellationRegistry } from '../execution/cancellation.js'
import { GraphExecutor } from '../execution/graph-executor.js'
import { StepController } from '../execution/step-controller.js'
import { buildManifestMap } from '../infra/manifests.js'
import type { EventBus } from '../transport/events.js'
import type { AgentRunner } from '../agents/agent-runner.js'

export interface ExecutionRouteDeps {
  project: Project
  bus: EventBus
  /** Bundled tool registry; merged with the project's custom nodes per run. */
  registry: NodeRegistry
  agentRunner?: AgentRunner
  /** Shared with every other path that starts a run, so any of them can be stopped. */
  runs: CancellationRegistry
  /** The engine's own API port, which a workflow's http_request never calls. */
  enginePort?: () => number
}

const runSchema = z.object({
  targetId: z.string().min(1),
  testMode: z.boolean().default(false),
  /** A saved backend profile id, or 'local'/omitted to run locally. */
  backendProfileId: z.string().optional(),
  /** 'run' executes to completion; 'step' pauses before each node. */
  mode: z.enum(['run', 'step']).default('run'),
})

export function executionRoutes(deps: ExecutionRouteDeps): Hono {
  const app = new Hono()
  const store = deps.project.runs
  const steps = new StepController()

  app.post('/workflows/:id/run', async (c) => {
    const id = c.req.param('id')
    const workflow = deps.project.workflows.get(id)
    if (workflow === undefined) return c.json({ error: 'unknown workflow' }, 404)

    const body = await c.req.json().catch(() => null)
    const parsed = runSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', detail: parsed.error.format() }, 400)
    }

    const backendProfileId = parsed.data.backendProfileId
    let backendProfile
    if (backendProfileId !== undefined && backendProfileId !== 'local') {
      backendProfile = deps.project.backends.get(backendProfileId)
      if (backendProfile === undefined) return c.json({ error: 'unknown backend profile' }, 400)
    }

    // Build the executor per run so custom nodes created since startup are in
    // scope: a graph node whose type equals a custom node id runs via the tool path.
    const executor = new GraphExecutor({
      project: deps.project,
      bus: deps.bus,
      manifests: buildManifestMap(deps.registry, deps.project),
      store,
      runs: deps.runs,
      ...(deps.agentRunner !== undefined ? { agentRunner: deps.agentRunner } : {}),
      ...(deps.enginePort !== undefined ? { enginePort: deps.enginePort } : {}),
    })

    const graph = graphSchema.parse(JSON.parse(workflow.graph))
    const runInput = {
      graph,
      workflowId: id,
      targetId: parsed.data.targetId,
      testMode: parsed.data.testMode,
      ...(backendProfile !== undefined ? { backendProfile } : {}),
    }

    if (parsed.data.mode === 'step') {
      // Fire-and-forget the run so the client can drive it node by node. The
      // execution id is surfaced via onExecutionCreated before we respond.
      let execId = ''
      let resolveId: (id: string) => void = () => {}
      const idReady = new Promise<string>((resolve) => {
        resolveId = resolve
      })
      const onExecutionCreated = (createdId: string): void => {
        execId = createdId
        steps.register(createdId)
        resolveId(createdId)
      }
      const beforeNode = async (nodeId: string): Promise<void> => {
        await steps.gate(execId, nodeId)
      }
      void executor
        .run({ ...runInput, beforeNode, onExecutionCreated })
        .catch(() => {})
        .finally(() => steps.unregister(execId))
      const executionId = await idReady
      return c.json({ executionId, status: 'running' })
    }

    const result = await executor.run(runInput)
    return c.json(result)
  })

/**
   * The recent STANDALONE runs — executions with no workflow behind them, which
   * is exactly what the Tools page starts. Each carries the params it ran with,
   * so the page can repeat a run and can restore a tool's last-used params from
   * the newest entry for that node. Newest first.
   */
  app.get('/executions/standalone', (c) => {
    const raw = Number(c.req.query('limit') ?? '25')
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25
    const runs = deps.project.executions.listStandalone(limit)
    const values = new Map(deps.project.targets.all().map((t) => [t.id, t.value]))
    return c.json(
      runs.map((r) => ({ ...r, targetValue: r.targetId === null ? null : (values.get(r.targetId) ?? null) })),
    )
  })

  app.get('/executions/:id', (c) => {
    const id = c.req.param('id')
    const base = deps.project.executions.get(id) ?? store.getExecution(id)
    if (base === undefined) return c.json({ error: 'not found' }, 404)
    return c.json({ ...base, nodes: store.nodesFor(id) })
  })

  // Persisted per-node output for a run, read from the evidence files the node
  // runner wrote. This is the durable source the UI falls back to once the live
  // event stream has rolled past (or a past run is reopened).
  app.get('/executions/:id/output', (c) => {
    const CAP = 200_000
    const read = (p: string | null): string => {
      if (p === null) return ''
      try {
        const text = readFileSync(p, 'utf8')
        return text.length > CAP ? text.slice(-CAP) : text
      } catch {
        return ''
      }
    }
    const nodes = store.nodesFor(c.req.param('id')).map((n) => ({
      nodeId: n.nodeId,
      status: n.status,
      // A null exit code means the process never ran (spawn failure) rather than
      // ran-and-returned-zero, so the UI must be able to tell them apart.
      exitCode: n.exitCode,
      stdout: read(n.stdoutPath),
      stderr: read(n.stderrPath),
      // Built-in nodes (screenshot, http, geoip…) never write a stdout file —
      // their result IS the parsed rows, so without this they look like nodes
      // that produced nothing.
      parsed: n.parsedOutput,
    }))
    return c.json(nodes)
  })

  app.get('/executions', (c) => c.json(store.listExecutions()))


  /**
   * Stop a run. The registry kills whatever process the run has open and the
   * executor gives up the walk, settling the row as `cancelled`.
   *
   * A row can also say `running` with no run behind it — the engine that was
   * executing it died — and the user has no other way to clear that, so this
   * settles it directly rather than reporting a run it cannot find.
   */
  app.post('/executions/:id/cancel', (c) => {
    const id = c.req.param('id')
    const execution = deps.project.executions.get(id) ?? store.getExecution(id)
    if (execution === undefined) return c.json({ error: 'not found' }, 404)
    if (execution.status !== 'running') return c.json({ error: 'run already finished' }, 409)

    if (!deps.runs.cancel(id)) {
      store.cancelRunningNodes(id)
      store.finishExecution(id, 'cancelled', 'Stopped by the user')
    }
    return c.json({ ok: true, status: 'cancelled' })
  })

  // Release the next node of a stepped run.
  app.post('/executions/:id/step', (c) => {
    const id = c.req.param('id')
    if (!steps.has(id)) return c.json({ error: 'not a stepped run' }, 404)
    steps.step(id)
    return c.json({ ok: true })
  })

  // Let a stepped run flow to completion. Idempotent even if unknown.
  app.post('/executions/:id/resume', (c) => {
    const id = c.req.param('id')
    steps.resume(id)
    return c.json({ ok: true })
  })

  return app
}
