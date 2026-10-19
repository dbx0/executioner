import { describe, expect, it } from 'vitest'
import { toEngineGraph, toReactFlow } from './convert.js'

describe('toEngineGraph', () => {
  it('strips reactflow render state but keeps position, type, and data', () => {
    const rfNodes = [
      { id: 'a', type: 'httpx', position: { x: 10, y: 20 }, data: { threads: 40 }, selected: true, width: 200 },
    ]
    const rfEdges = [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'true', selected: false }]
    const graph = toEngineGraph(rfNodes as never, rfEdges as never)
    expect(graph.nodes[0]).toEqual({ id: 'a', type: 'httpx', data: { threads: 40 }, position: { x: 10, y: 20 } })
    expect(graph.edges[0]).toEqual({ id: 'e', source: 'a', target: 'b', sourceHandle: 'true' })
  })

  it('defaults a missing sourceHandle to null', () => {
    const graph = toEngineGraph(
      [{ id: 'a', type: 'x', position: { x: 0, y: 0 }, data: {} }] as never,
      [{ id: 'e', source: 'a', target: 'b' }] as never,
    )
    expect(graph.edges[0]!.sourceHandle).toBeNull()
  })
})

describe('toReactFlow', () => {
  it('adds a default position when the engine node lacks one', () => {
    const { nodes } = toReactFlow({ nodes: [{ id: 'a', type: 'x', data: {} }], edges: [] })
    expect(nodes[0]!.position).toEqual({ x: 0, y: 0 })
  })

  it('round-trips a graph', () => {
    const graph = {
      nodes: [{ id: 'a', type: 'httpx', data: { threads: 40 }, position: { x: 5, y: 6 } }],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: null }],
    }
    const { nodes, edges } = toReactFlow(graph)
    expect(toEngineGraph(nodes, edges)).toEqual(graph)
  })
})
