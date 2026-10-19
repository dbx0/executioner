import { interpolate } from '@exe/nodes'
import type { Graph } from '@exe/graph'
import type { Target } from '@exe/protocol'
import { buildScope, type LoopContext, type NodeOutput } from '../../../infra/template-scope.js'
import { upstreamRows } from '../helpers.js'
import { finishBuiltin, type BuiltinNodeDeps } from './shared.js'

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info'])

/** Resolve one templated param against a scope that includes this row. */
function field(raw: unknown, ctx: Record<string, unknown>): string {
  if (typeof raw !== 'string' || raw.trim() === '') return ''
  return (interpolate(raw, ctx) ?? '').trim()
}

/**
 * A row's fallback title, for a node wired up without one: the first stringy
 * field that reads like a name. Better than skipping the row silently — the
 * whole point of this node is that results stop disappearing.
 */
function fallbackTitle(row: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'finding', 'rule', 'match', 'value', 'host', 'url']) {
    const v = row[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return ''
}

/**
 * save_to_finding: turn the rows feeding into this node into engagement
 * findings — the counterpart to save_to_target, for what the work proved rather
 * than what it discovered.
 *
 * Every param is a template evaluated PER ROW, with `{{ row.field }}` bound to
 * the row in hand, so one node handles a whole result set:
 *   title: Secret in {{ row.file }}   severity: high   details: {{ row.match }}
 *
 * Rows with no title are skipped (an empty result set must not write empty
 * findings), and each one goes through `record()`, so re-running a workflow
 * refreshes what it already filed instead of stacking duplicates — and never
 * reopens a finding somebody has triaged.
 */
export function runSaveToFinding(
  deps: BuiltinNodeDeps,
  node: { id: string; data: Record<string, unknown> },
  graph: Graph,
  target: Target | undefined,
  executionId: string,
  nodeOutputs: Record<string, NodeOutput>,
  vars: Record<string, unknown>,
  secrets: Record<string, string>,
  loop?: LoopContext | undefined,
): void {
  deps.bus.publish({ type: 'status', executionId, nodeId: node.id, data: 'running' })

  const rows = upstreamRows(node.id, graph, nodeOutputs)
  const scopeWith = (row: Record<string, unknown>): Record<string, unknown> => ({
    ...buildScope({
      params: {},
      target: target === undefined ? { value: '', kind: 'domain' } : { value: target.value, kind: target.kind },
      runDir: deps.project.evidenceDir(executionId),
      nodeOutputs,
      vars,
      secrets,
      row,
      ...(loop !== undefined ? { loop } : {}),
    }),
  })

  const written: Array<Record<string, unknown>> = []
  let created = 0
  for (const row of rows) {
    const ctx = scopeWith(row)
    const title = field(node.data.title, ctx) || fallbackTitle(row)
    if (title === '') continue

    const severityRaw = field(node.data.severity, ctx).toLowerCase()
    const severity = SEVERITIES.has(severityRaw) ? severityRaw : 'medium'

    // The finding attaches to the node's own target param when it names one,
    // else to the target the run is against. An unresolvable value is left
    // unattached rather than inventing an asset row.
    const targetValue = field(node.data.target, ctx)
    const owner =
      targetValue === '' || targetValue === target?.value
        ? target
        : deps.project.targets.all().find((t) => t.value === targetValue)

    const result = deps.project.findings.record({
      title,
      severity,
      description: field(node.data.description, ctx),
      // With nothing configured, the row itself is the evidence — losing it is
      // exactly the problem this node exists to fix.
      details: field(node.data.details, ctx) || JSON.stringify(row),
      targetId: owner?.id ?? null,
      source: 'workflow',
      executionId,
      nodeId: node.id,
    })
    if (result.created) created += 1
    written.push({
      id: result.finding.id,
      title: result.finding.title,
      severity: result.finding.severity,
      status: result.finding.status,
      created: result.created,
    })
  }

  const summary = `${String(written.length)} finding${written.length === 1 ? '' : 's'} recorded (${String(created)} new)`
  finishBuiltin(deps, executionId, node.id, 'succeeded', summary, written, null)
}
