import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { GraphNodeData } from '../components/canvas/GraphNodes.js'
import type { ParamSpec } from '../components/canvas/ParamDrawer.js'
import { validateWorkflow } from './workflow-validate.js'

function node(
  id: string,
  overrides: Partial<GraphNodeData> = {},
): Node<GraphNodeData> {
  const data: GraphNodeData = {
    label: overrides.label ?? id,
    nodeType: overrides.nodeType ?? id,
    kind: overrides.kind ?? 'tool',
    category: overrides.category ?? 'action',
    availableParams: overrides.availableParams ?? [],
    params: overrides.params ?? {},
  }
  return { id, type: data.nodeType, position: { x: 0, y: 0 }, data }
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target }
}

describe('validateWorkflow', () => {
  it('reports no errors for a valid linear graph', () => {
    const nodes = [node('a', { kind: 'manual' }), node('b'), node('c')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]
    const issues = validateWorkflow(nodes, edges)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('flags a missing required param and cites the node', () => {
    const param: ParamSpec = { name: 'url', type: 'string', required: true }
    const nodes = [
      node('a', { kind: 'manual' }),
      node('b', { label: 'Fetch', availableParams: [param], params: {} }),
    ]
    const edges = [edge('e1', 'a', 'b')]
    const issues = validateWorkflow(nodes, edges)
    const err = issues.find((i) => i.nodeId === 'b' && i.severity === 'error')
    expect(err?.message).toBe('url is required on Fetch')
  })

  it('does not flag a required param satisfied by a default', () => {
    const param: ParamSpec = { name: 'method', type: 'string', required: true, default: 'GET' }
    const nodes = [node('a', { kind: 'manual' }), node('b', { availableParams: [param], params: {} })]
    const edges = [edge('e1', 'a', 'b')]
    const issues = validateWorkflow(nodes, edges)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('reports a structural error for a cycle', () => {
    const nodes = [node('a', { kind: 'manual' }), node('b')]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')]
    const issues = validateWorkflow(nodes, edges)
    expect(issues.some((i) => i.severity === 'error' && /cycle/i.test(i.message))).toBe(true)
  })

  it('reports an error for an empty graph', () => {
    const issues = validateWorkflow([], [])
    expect(issues.some((i) => i.severity === 'error' && i.message === 'Workflow has no nodes')).toBe(
      true,
    )
  })

  it('warns about a disconnected node', () => {
    const nodes = [node('a', { kind: 'manual' }), node('b'), node('lonely', { label: 'Lonely' })]
    const edges = [edge('e1', 'a', 'b')]
    const issues = validateWorkflow(nodes, edges)
    const warn = issues.find((i) => i.nodeId === 'lonely' && i.severity === 'warning')
    expect(warn?.message).toBe('Lonely is not connected')
  })

  it('warns when there is no trigger node', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('e1', 'a', 'b')]
    const issues = validateWorkflow(nodes, edges)
    expect(
      issues.some(
        (i) => i.severity === 'warning' && i.message.startsWith('No trigger node'),
      ),
    ).toBe(true)
  })
})
