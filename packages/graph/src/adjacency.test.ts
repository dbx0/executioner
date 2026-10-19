import { describe, expect, it } from 'vitest'
import { graphSchema } from './model.js'
import { buildAdjacency } from './adjacency.js'

const g = graphSchema.parse({
  nodes: [
    { id: 'a', type: 'if', data: {} },
    { id: 'b', type: 'httpx', data: {} },
    { id: 'c', type: 'nuclei', data: {} },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'true' },
    { id: 'e2', source: 'a', target: 'c', sourceHandle: 'false' },
    { id: 'e3', source: 'b', target: 'c' },
  ],
})

describe('buildAdjacency', () => {
  it('maps each source to its targets with the source handle', () => {
    const { forward } = buildAdjacency(g)
    expect(forward.get('a')).toEqual([
      { target: 'b', sourceHandle: 'true' },
      { target: 'c', sourceHandle: 'false' },
    ])
  })

  it('maps each target back to its sources', () => {
    const { reverse } = buildAdjacency(g)
    expect(reverse.get('c')).toEqual([
      { source: 'a', sourceHandle: 'false' },
      { source: 'b', sourceHandle: null },
    ])
  })

  it('returns empty lists for a node with no edges', () => {
    const { forward, reverse } = buildAdjacency(g)
    expect(forward.get('c') ?? []).toEqual([])
    expect(reverse.get('a') ?? []).toEqual([])
  })
})
