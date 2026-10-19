import { describe, expect, it } from 'vitest'
import { graphSchema } from './model.js'

const graph = {
  nodes: [
    { id: 'n1', type: 'subfinder', data: { label: 'find subs' } },
    { id: 'n2', type: 'httpx', data: {} },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
}

describe('graphSchema', () => {
  it('parses a minimal graph', () => {
    const g = graphSchema.parse(graph)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges[0]!.sourceHandle).toBeNull()
  })

  it('preserves a sourceHandle when present', () => {
    const g = graphSchema.parse({
      nodes: [{ id: 'a', type: 'if', data: {} }, { id: 'b', type: 'httpx', data: {} }],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'true' }],
    })
    expect(g.edges[0]!.sourceHandle).toBe('true')
  })

  it('defaults an absent data bag to an empty object', () => {
    const g = graphSchema.parse({ nodes: [{ id: 'a', type: 'stop' }], edges: [] })
    expect(g.nodes[0]!.data).toEqual({})
  })

  it('ignores unknown positional fields React Flow adds', () => {
    const g = graphSchema.parse({
      nodes: [{ id: 'a', type: 'httpx', data: {}, position: { x: 10, y: 20 }, width: 200 }],
      edges: [],
    })
    expect(g.nodes[0]!.id).toBe('a')
  })

  it('rejects a node with no id', () => {
    expect(() => graphSchema.parse({ nodes: [{ type: 'httpx', data: {} }], edges: [] })).toThrow()
  })

  it('rejects an edge missing a target', () => {
    expect(() =>
      graphSchema.parse({ nodes: [{ id: 'a', type: 'x', data: {} }], edges: [{ id: 'e', source: 'a' }] }),
    ).toThrow()
  })
})
