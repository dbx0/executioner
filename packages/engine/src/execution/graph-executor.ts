import type { RunRepository } from '@exe/db'
import {
  buildAdjacency,
  loopBody,
  propagateSkip,
  topologicalSort,
  validateGraph,
} from '@exe/graph'
import { NodeRunner } from './node-runner.js'
import { launcherForProfile, type CommandLauncher } from '../infra/launcher.js'
import { type LoopContext, type NodeOutput } from '../infra/template-scope.js'
import type { Graph } from '@exe/graph'
import type { Target } from '@exe/protocol'
import {
  runCensys,
  runGeoip,
  runHttpRequest,
  runMerge,
  runNotify,
  runPythonScript,
  runSaveToFinding,
  runSaveToTarget,
  runScreenshot,
  runIf,
  runSetVariable,
  runShodan,
  runTrigger,
} from './graph-executor/builtin-nodes.js'
import { lastUpstreamRow, resolveLoopItems } from './graph-executor/helpers.js'
import { runAgentNode, runToolNode } from './graph-executor/node-handlers.js'
import { EXECUTION_CHANNEL, type GraphExecutorDeps, type GraphRunInput, type GraphRunResult } from './graph-executor/types.js'

export type { GraphExecutorDeps, GraphRunInput, GraphRunResult }

export class GraphExecutor {
  private readonly runner: NodeRunner
  /** Kept as a direct field (in addition to `deps.store`) so callers/tests can
   * reach the execution store via `executor['store']` without threading a
   * public accessor through the whole class. */
  private readonly store: RunRepository

  constructor(private readonly deps: GraphExecutorDeps) {
    this.runner = new NodeRunner({
      bus: deps.bus,
      project: deps.project,
      ...(deps.runs !== undefined ? { runs: deps.runs } : {}),
    })
    this.store = deps.store
  }

  /**
   * Run a graph. The walk itself is {@link execute}; this wrapper registers the
   * run with the cancellation registry the moment its execution row exists and
   * drops it when the run settles, so "stop" has something to aim at for exactly
   * as long as the run is live.
   */
  async run(input: GraphRunInput): Promise<GraphRunResult> {
    const { runs } = this.deps
    let executionId: string | undefined
    const onExecutionCreated = (id: string): void => {
      executionId = id
      runs?.register(id)
      input.onExecutionCreated?.(id)
    }
    try {
      return await this.execute({ ...input, onExecutionCreated })
    } finally {
      if (executionId !== undefined) runs?.unregister(executionId)
    }
  }

  private async execute(input: GraphRunInput): Promise<GraphRunResult> {
    const { graph, workflowId, targetId, testMode, beforeNode, onExecutionCreated } = input
    const { bus, store, project } = this.deps

    const launcher = launcherForProfile(input.backendProfile)
    const vars: Record<string, unknown> = {}
    // Load the engagement's API credentials once so nodes/params can reference
    // them as {{ secrets.NAME }} and the API-key nodes can resolve their keys.
    const secrets = project.secrets.map()
    const validation = validateGraph(graph)
    const exec = store.createExecution({ workflowId, targetId, backend: launcher.kind, testMode })
    onExecutionCreated?.(exec.id)

    if (!validation.ok) {
      store.finishExecution(exec.id, 'failed', validation.errors.join('; '))
      bus.publish({ type: 'status', executionId: exec.id, nodeId: EXECUTION_CHANNEL, data: 'failed' })
      return { executionId: exec.id, status: 'failed' }
    }

    const target = targetId === null ? undefined : project.targets.get(targetId)

    const order = topologicalSort(graph)
    const adj = buildAdjacency(graph)
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))

    const skipped = new Set<string>()
    const loopHandled = new Set<string>()
    const nodeOutputs: Record<string, NodeOutput> = {}
    let stopped = false

    /** True once the user has stopped this run: no further node may start. */
    const isCancelled = (): boolean => this.deps.runs?.isCancelled(exec.id) === true

    /** Settle a stopped run: close any open node row and report it as cancelled. */
    const finishCancelled = (): GraphRunResult => {
      store.cancelRunningNodes(exec.id)
      store.finishExecution(exec.id, 'cancelled', 'Stopped by the user')
      bus.publish({ type: 'status', executionId: exec.id, nodeId: EXECUTION_CHANNEL, data: 'cancelled' })
      return { executionId: exec.id, status: 'cancelled' }
    }

    for (const nodeId of order) {
      if (isCancelled()) return finishCancelled()
      if (stopped || skipped.has(nodeId) || loopHandled.has(nodeId)) continue
      const node = byId.get(nodeId)
      if (node === undefined) continue

      if (node.type === 'stop') {
        stopped = true
        continue
      }

      // Gate every node that will actually do work (triggers/if/loop/agent/
      // builtin/tool). Stop and skipped nodes above never reach here, so they do
      // not consume a step permit.
      if (beforeNode !== undefined) await beforeNode(nodeId)
      // A stepped run can sit at that gate for a long time, and a stop is the
      // usual way out of one — so check again on the way through.
      if (isCancelled()) return finishCancelled()

      // Trigger nodes are entry markers: how a workflow starts (manual run, a
      // schedule, or a target being created). They do no work themselves — they
      // emit the running/succeeded lifecycle and pass control to downstream
      // nodes, so a workflow that begins with a trigger runs normally.
      if (node.type === 'manual' || node.type === 'schedule' || node.type === 'on_create') {
        store.startNode({ executionId: exec.id, nodeId })
        runTrigger(this.deps, node, exec.id, nodeOutputs)
        continue
      }

      if (node.type === 'if') {
        store.startNode({ executionId: exec.id, nodeId })
        const branch = runIf(
          this.deps,
          node,
          lastUpstreamRow(nodeId, adj, nodeOutputs),
          target,
          exec.id,
          nodeOutputs,
          vars,
          secrets,
        )
        propagateSkip(nodeId, branch, adj, skipped)
        continue
      }

      if (node.type === 'loop') {
        const items = resolveLoopItems(project, node.data.source, target, exec.id, nodeOutputs)
        const body = loopBody(nodeId, adj)
        for (const id of body) loopHandled.add(id)
        for (let index = 0; index < items.length; index += 1) {
          if (isCancelled()) return finishCancelled()
          const loop: LoopContext = { item: items[index], index, count: items.length }
          // An `if` inside the body gates the rest of THIS iteration only, so the
          // skip set is rebuilt per item rather than shared across them.
          const bodySkipped = new Set<string>()
          for (const bodyId of order.filter((id) => body.has(id))) {
            if (isCancelled()) return finishCancelled()
            const bodyNode = byId.get(bodyId)
            if (bodyNode === undefined || bodySkipped.has(bodyId)) continue
            if (bodyNode.type === 'if') {
              store.startNode({ executionId: exec.id, nodeId: bodyId })
              const branch = runIf(
                this.deps,
                bodyNode,
                lastUpstreamRow(bodyId, adj, nodeOutputs),
                target,
                exec.id,
                nodeOutputs,
                vars,
                secrets,
                loop,
              )
              propagateSkip(bodyId, branch, adj, bodySkipped)
              continue
            }
            await this.runOne(bodyNode, graph, target, exec.id, nodeOutputs, loop, launcher, vars, secrets)
          }
        }
        continue
      }

      await this.runOne(node, graph, target, exec.id, nodeOutputs, undefined, launcher, vars, secrets)
      if (isCancelled()) return finishCancelled()

      // Per-node failure policy: halt the run if this node failed and its
      // on_failure setting is 'stop' (default 'continue', preserving prior behavior).
      if (String((node.data as { __on_failure?: unknown }).__on_failure ?? 'continue') === 'stop') {
        const status = store.nodesFor(exec.id).find((n) => n.nodeId === node.id)?.status
        if (status === 'failed' || status === 'timeout') stopped = true
      }
    }

    if (isCancelled()) return finishCancelled()

    // The run is only a success if every node that ran was. Reporting 'succeeded'
    // unconditionally hid whole runs of dead nodes from anything watching status.
    const failedNodes = store.nodesFor(exec.id).filter((n) => n.status === 'failed' || n.status === 'timeout')
    if (failedNodes.length > 0) {
      const names = [...new Set(failedNodes.map((n) => n.nodeId))]
      const summary = `${String(failedNodes.length)} node${failedNodes.length === 1 ? '' : 's'} failed: ${names.join(', ')}`
      store.finishExecution(exec.id, 'failed', summary)
      bus.publish({ type: 'status', executionId: exec.id, nodeId: EXECUTION_CHANNEL, data: 'failed' })
      return { executionId: exec.id, status: 'failed' }
    }

    store.finishExecution(exec.id, 'succeeded')
    bus.publish({ type: 'status', executionId: exec.id, nodeId: EXECUTION_CHANNEL, data: 'succeeded' })
    return { executionId: exec.id, status: 'succeeded' }
  }

  /**
   * Run one node by its type. Shared by the top-level walk and by loop bodies —
   * a loop body used to assume every node was a manifest-backed tool, so any
   * built-in inside one (python_script, screenshot, if, http_request…) had no
   * manifest and failed instantly with no output at all.
   *
   * `loop` is threaded through so `{{ loop.item }}` resolves inside built-ins the
   * same way it does for tool nodes.
   */
  private async runOne(
    node: { id: string; type: string; data: Record<string, unknown> },
    graph: Graph,
    target: Target | undefined,
    executionId: string,
    nodeOutputs: Record<string, NodeOutput>,
    loop: LoopContext | undefined,
    launcher: CommandLauncher,
    vars: Record<string, unknown>,
    secrets: Record<string, string>,
  ): Promise<void> {
    // Announce the start before any work, so a client asking "what is running?"
    // gets an answer even for a tool that stays silent for minutes.
    this.deps.store.startNode({ executionId, nodeId: node.id })
    if (node.type === 'agent') {
      await runAgentNode(this.deps, node, target, executionId, nodeOutputs, vars, secrets)
    } else if (node.type === 'set_variable') {
      runSetVariable(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'merge') {
      runMerge(this.deps, node, graph, executionId, nodeOutputs)
    } else if (node.type === 'save_to_target') {
      runSaveToTarget(this.deps, node, graph, target, executionId, nodeOutputs)
    } else if (node.type === 'save_to_finding') {
      runSaveToFinding(this.deps, node, graph, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'http_request') {
      await runHttpRequest(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'notify') {
      await runNotify(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'geoip') {
      await runGeoip(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'shodan') {
      await runShodan(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'censys') {
      await runCensys(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'screenshot') {
      await runScreenshot(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else if (node.type === 'python_script') {
      await runPythonScript(this.deps, node, target, executionId, nodeOutputs, vars, secrets, loop)
    } else {
      // A tool node.
      await runToolNode(this.deps, this.runner, node, target, executionId, nodeOutputs, loop, launcher, vars, secrets)
    }
  }

}
