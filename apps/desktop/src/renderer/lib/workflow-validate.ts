import type { Edge, Node } from 'reactflow'
import { validateGraph } from '@exe/graph'
import type { GraphNodeData } from '../components/canvas/GraphNodes.js'
import { toEngineGraph } from '../components/canvas/convert.js'

export interface WorkflowIssue {
  nodeId?: string
  message: string
  severity: 'error' | 'warning'
}

const TRIGGER_KINDS = new Set(['manual', 'schedule', 'on_create'])

/** True when a param value counts as "provided" (not missing / undefined / empty string). */
function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/**
 * Pure, deterministic pre-run validation for a workflow graph. Mirrors the
 * engine's structural checks (via `validateGraph`) and adds client-only checks
 * (required params, connectivity, trigger presence) so the UI can surface inline
 * errors before calling the engine.
 */
export function validateWorkflow(nodes: Node<GraphNodeData>[], edges: Edge[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = []

  // a. Structural checks, delegated to the engine's validator. `toEngineGraph`
  // returns the app's structural Graph type; `validateGraph` only reads it, so
  // it is safe to hand across to the engine's (zod-inferred, passthrough) shape.
  const structural = validateGraph(toEngineGraph(nodes, edges) as Parameters<typeof validateGraph>[0])
  if (!structural.ok) {
    for (const message of structural.errors) {
      issues.push({ message, severity: 'error' })
    }
  }

  // b. Empty graph.
  if (nodes.length === 0) {
    issues.push({ message: 'Workflow has no nodes', severity: 'error' })
  }

  // c. Required params.
  for (const node of nodes) {
    const data = node.data
    if (data === undefined) continue
    const nodeLabel = data.label
    for (const param of data.availableParams ?? []) {
      if (param.required !== true) continue
      const provided = hasValue(data.params?.[param.name])
      const hasDefault = hasValue(param.default)
      if (!provided && !hasDefault) {
        const paramLabel = param.label ?? param.name
        issues.push({
          nodeId: node.id,
          message: `${paramLabel} is required on ${nodeLabel}`,
          severity: 'error',
        })
      }
    }
  }

  // d. Disconnected nodes (only meaningful with more than one node).
  if (nodes.length > 1) {
    const withIncoming = new Set(edges.map((e) => e.target))
    const withOutgoing = new Set(edges.map((e) => e.source))
    for (const node of nodes) {
      const hasIncoming = withIncoming.has(node.id)
      const hasOutgoing = withOutgoing.has(node.id)
      const isTrigger = node.data !== undefined && TRIGGER_KINDS.has(node.data.kind)
      // Triggers legitimately have no incoming edge; only flag them when they
      // also have no outgoing edge. Non-triggers must have at least one edge.
      const disconnected = isTrigger ? !hasOutgoing : !hasIncoming && !hasOutgoing
      if (disconnected) {
        const label = node.data?.label ?? node.id
        issues.push({ nodeId: node.id, message: `${label} is not connected`, severity: 'warning' })
      }
    }
  }

  // e. Trigger presence.
  const hasTrigger = nodes.some((n) => n.data !== undefined && TRIGGER_KINDS.has(n.data.kind))
  if (!hasTrigger) {
    issues.push({
      message: 'No trigger node — this workflow can only be run manually',
      severity: 'warning',
    })
  }

  return issues
}
