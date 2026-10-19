import { evaluateIfOutcome, type Graph } from '@exe/graph'
import { interpolate } from '@exe/nodes'
import '../../../infra/linear-regex.js'
import type { Target } from '@exe/protocol'
import type { LoopContext, NodeOutput } from '../../../infra/template-scope.js'
import { scopeFor, upstreamRows } from '../helpers.js'
import { finishBuiltin, type BuiltinNodeDeps } from './shared.js'

/**
 * IF node: decide which branch the run takes, and leave a record of it.
 *
 * The expression is interpolated first, so `{{ nodes.x.field }}` works here the
 * way it does in every other node's data — writing a template used to compile to
 * a syntax error, get swallowed, and quietly take the false branch, skipping the
 * whole downstream for reasons that appeared nowhere.
 *
 * The result is now persisted like any other node (it previously recorded
 * nothing at all, so an IF never showed up in a run), and an expression that
 * cannot be evaluated is a visible failure rather than an invisible false.
 */
export function runIf(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
  upstreamRow: Record<string, unknown>,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  loop?: LoopContext | undefined,
): 'true' | 'false' {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const ctx = scopeFor(deps.project, target, executionId, nodeOutputs, vars, secrets, loop)
  const written = String(node.data.expression ?? '')
  const expression = interpolate(written, ctx) ?? written
  const { branch, error } = evaluateIfOutcome(expression, upstreamRow)

  const row: Record<string, unknown> = { expression, branch }
  if (written !== expression) row.written = written
  if (error !== undefined) row.error = error
  nodeOutputs[node.id] = { output: branch, rows: [row] }

  if (error !== undefined) {
    finishBuiltin(
      deps,
      executionId,
      node.id,
      'failed',
      `condition "${expression}" could not be evaluated: ${error}; taking the false branch`,
      [row],
      null,
    )
  } else {
    finishBuiltin(deps, executionId, node.id, 'succeeded', `branch=${branch}`, [row], null)
  }
  return branch
}

/** Trigger entry node: no-op pass-through that emits running → succeeded. */
export function runTrigger(
  deps: BuiltinNodeDeps,
  node: { id: string; type: string; data: Record<string, unknown> },
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
): void {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const row: Record<string, unknown> = { trigger: node.type }
  nodeOutputs[node.id] = { output: '', rows: [row] }
  finishBuiltin(deps, executionId, node.id, 'succeeded', '', [row], null)
}

/** set_variable: interpolate a JSON map of {name: templated-value} into run vars. */
export function runSetVariable(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  loop?: LoopContext | undefined,
): void {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const ctx = scopeFor(deps.project, target, executionId, nodeOutputs, vars, secrets, loop)
  let assignments: Record<string, unknown> = {}
  const raw = node.data.variables
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      assignments = JSON.parse(raw) as Record<string, unknown>
    } catch {
      finishBuiltin(deps, executionId, node.id, 'failed', 'invalid variables JSON', [], null)
      return
    }
  } else if (raw !== null && typeof raw === 'object') {
    assignments = raw as Record<string, unknown>
  }
  for (const [key, value] of Object.entries(assignments)) {
    // A key from JSON can be `__proto__`, which as an assignment would swap the
    // prototype of the run's variables rather than set a variable.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    vars[key] = typeof value === 'string' ? (interpolate(value, ctx) ?? value) : value
  }
  const snapshot = { ...vars }
  nodeOutputs[node.id] = { output: JSON.stringify(snapshot), rows: [snapshot] }
  finishBuiltin(deps, executionId, node.id, 'succeeded', JSON.stringify(snapshot), [snapshot], null)
}

/** merge: union the rows/output of every upstream node into this node's output. */
export function runMerge(
  deps: BuiltinNodeDeps,
  node: { id: string },
  graph: Graph,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
): void {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const sources = graph.edges.filter((e) => e.target === node.id).map((e) => e.source)
  const rows = sources.flatMap((s) => nodeOutputs[s]?.rows ?? [])
  const output = sources.map((s) => nodeOutputs[s]?.output ?? '').filter((o) => o !== '').join('\n')
  nodeOutputs[node.id] = { output, rows }
  finishBuiltin(deps, executionId, node.id, 'succeeded', output, rows, null)
}

/** save_to_target: persist upstream rows as targets/facts per the data_type. */
export function runSaveToTarget(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
  graph: Graph,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
): void {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })
  const dataType = String(node.data.data_type ?? 'raw_output')
  const field = String(node.data.field ?? 'value')
  const rows = upstreamRows(node.id, graph, nodeOutputs)
  // Don't persist empty/degenerate results (e.g. a filter that produced "[]").
  const isBlank = (v: unknown): boolean => {
    if (v === undefined || v === null) return true
    if (typeof v === 'string') {
      const t = v.trim()
      return t === '' || t === '[]' || t === '{}'
    }
    if (Array.isArray(v)) return v.length === 0
    return false
  }
  let saved = 0
  for (const row of rows) {
    const value = row[field] ?? row.value ?? row.host ?? row.output
    if (isBlank(value)) continue
    if (dataType === 'subdomain') {
      if (typeof value === 'string' && value !== '') {
        // Subdomain-enumeration tools routinely echo the apex domain itself in
        // their results. Saving it as a `subdomain` child of the scanned target
        // would create a redundant row nested under its own equal value, so
        // skip a value identical to the target it was discovered under.
        if (target !== undefined && value.toLowerCase() === target.value.toLowerCase()) continue
        deps.project.targets.upsert({
          kind: 'subdomain',
          value,
          source: 'workflow',
          parentId: target?.id ?? null,
        })
        saved += 1
      }
    } else if (target !== undefined) {
      const factKind = dataType === 'open_port' ? 'port' : dataType === 'technology' ? 'technology' : 'raw_output'
      deps.project.facts.record({
        targetId: target.id,
        kind: factKind,
        executionId,
        nodeId: node.id,
        data: row,
      })
      saved += 1
    }
  }
  const summary = { saved, data_type: dataType }
  nodeOutputs[node.id] = { output: JSON.stringify(summary), rows: [summary] }
  finishBuiltin(deps, executionId, node.id, 'succeeded', JSON.stringify(summary), [summary], null)
}
