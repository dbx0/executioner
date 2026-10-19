import { interpolate, resolveParams } from '@exe/nodes'
import type { Target, TargetKind } from '@exe/protocol'
import type { CommandLauncher } from '../../infra/launcher.js'
import type { NodeRunner } from '../node-runner.js'
import { buildScope, type LoopContext, type NodeOutput } from '../../infra/template-scope.js'
import type { GraphExecutorDeps } from './types.js'

/** Classify a bare string so a loop item can become a real target row. */
function kindOf(value: string): TargetKind {
  if (/^https?:\/\//i.test(value)) return 'url'
  if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(value)) return 'cidr'
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return 'ip'
  // A hostname with more labels than its registrable form is a subdomain.
  return value.split('.').length > 2 ? 'subdomain' : 'domain'
}

/** Run a manifest-backed tool node: resolve params, execute, persist the result. */
export async function runToolNode(
  deps: GraphExecutorDeps,
  runner: NodeRunner,
  node: { id: string; type: string; data: Record<string, unknown> },
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  loop: LoopContext | undefined,
  launcher: CommandLauncher,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<void> {
  const manifest = deps.manifests.get(node.type)
  if (manifest === undefined || target === undefined) {
    deps.store.recordNode({
      executionId,
      nodeId: node.id,
      status: 'failed',
      exitCode: null,
      stdoutPath: null,
      stderrPath: null,
      parsedOutput: null,
    })
    // Emit a terminal event so live status listeners mark the node failed
    // rather than leaving it pending.
    deps.bus.publish({ type: 'done', executionId, nodeId: node.id, data: 'failed' })
    return
  }

  const runDir = deps.project.evidenceDir(executionId)
  const scopeFor = (t: Target): Record<string, unknown> => ({
    ...buildScope({
      params: {},
      target: { value: t.value, kind: t.kind },
      runDir,
      nodeOutputs,
      vars,
      secrets,
      ...(loop !== undefined ? { loop } : {}),
    }),
  })

  // A tool node may name its own target — `{{ loop.item }}` above all, so a loop
  // body scans each item rather than re-scanning the run's target N times. The
  // value resolves to a real target row (a child of the run's target) so the
  // facts it emits attach to the host that was actually scanned. This is settled
  // FIRST: everything else interpolates against the target the tool really gets,
  // so `{{ target.value }}` elsewhere on the node agrees with what ran.
  const requested =
    typeof node.data.target === 'string' ? (interpolate(node.data.target, scopeFor(target)) ?? '').trim() : ''
  const effectiveTarget =
    requested === '' || requested === target.value
      ? target
      : deps.project.targets.upsert({
          kind: kindOf(requested),
          value: requested,
          source: node.id,
          parentId: target.id,
        })

  // Resolve any templated data params against that scope before the manifest's
  // own param resolution runs.
  const scopeCtx = scopeFor(effectiveTarget)
  const rawParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.data)) {
    rawParams[key] = typeof value === 'string' ? (interpolate(value, scopeCtx) ?? value) : value
  }
  const params = resolveParams(manifest, rawParams)

  // Signal the node is now running so live status listeners can paint it; the
  // runner emits the terminal 'done' event with the final status.
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })

  const timeoutOverride = Number((node.data as { __timeout_ms?: unknown }).__timeout_ms)
  // Per-node "don't save" flag: run the tool for its output but skip persisting
  // its emitted facts/targets (mirrors the original app's `no_aggregate`).
  const noSave = node.data.__no_save === true || String(node.data.__no_save ?? '') === 'true'
  const result = await runner.run({
    manifest,
    params,
    target: effectiveTarget,
    executionId,
    nodeId: node.id,
    launcher,
    persist: !noSave,
    ...(Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? { timeoutMs: timeoutOverride } : {}),
  })

  nodeOutputs[node.id] = { output: result.output, rows: result.rows }
  deps.store.recordNode({
    executionId,
    nodeId: node.id,
    status:
      result.status === 'timeout' || result.status === 'cancelled'
        ? result.status
        : result.exitCode === 0
          ? 'succeeded'
          : 'failed',
    exitCode: result.exitCode,
    stdoutPath: `${runDir}/${node.id}.stdout`,
    stderrPath: `${runDir}/${node.id}.stderr`,
    parsedOutput: result.rows,
  })
}

/** Run an agent node: interpolate the prompt, hand it to the agent runner, persist the result. */
export async function runAgentNode(
  deps: GraphExecutorDeps,
  node: { id: string; type: string; data: Record<string, unknown> },
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<void> {
  const runner = deps.agentRunner
  const runDir = deps.project.evidenceDir(executionId)
  if (runner === undefined) {
    deps.store.recordNode({
      executionId,
      nodeId: node.id,
      status: 'failed',
      exitCode: null,
      stdoutPath: null,
      stderrPath: null,
      parsedOutput: null,
    })
    deps.bus.publish({ type: 'done', executionId, nodeId: node.id, data: 'failed' })
    return
  }

  const scope = buildScope({
    params: {},
    target: target === undefined ? { value: '', kind: 'domain' } : { value: target.value, kind: target.kind },
    runDir,
    nodeOutputs,
    vars,
    secrets,
  })
  const scopeCtx: Record<string, unknown> = { ...scope }
  const prompt = interpolate(String(node.data.prompt ?? ''), scopeCtx) ?? String(node.data.prompt ?? '')

  // Signal the node is running so live status listeners paint it; the terminal
  // 'done' below carries the final status.
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })

  const agent = String(node.data.agent ?? 'claude')
  // Off unless the node opts in: lets a CLI whose own tools cannot be locked
  // down headless (cursor, hermes) run at all.
  const allowUnrestrictedCli = node.data.allow_unrestricted_cli === true
  const result = await runner.runAuto({ nodeId: node.id, executionId, prompt, agent, allowUnrestrictedCli })
  nodeOutputs[node.id] = { output: result.transcript, rows: result.parsed }
  const status = result.parsed.length > 0 ? 'succeeded' : 'failed'
  deps.store.recordNode({
    executionId,
    nodeId: node.id,
    status,
    exitCode: status === 'succeeded' ? 0 : 1,
    stdoutPath: `${runDir}/${node.id}.transcript`,
    stderrPath: null,
    parsedOutput: result.parsed,
  })
  deps.bus.publish({ type: 'done', executionId, nodeId: node.id, data: status })
}
