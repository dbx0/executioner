import { describe, expect, it } from 'vitest'
import { graphSchema } from './model.js'
import { topologicalSort } from './topo.js'

const parse = (nodes: unknown[], edges: unknown[]) => graphSchema.parse({ nodes, edges })

describe('topologicalSort', () => {
  it('orders a linear chain', () => {
    const g = parse(
      [
        { id: 'a', type: 't', data: {} },
        { id: 'b', type: 't', data: {} },
        { id: 'c', type: 't', data: {} },
      ],
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    )
    expect(topologicalSort(g)).toEqual(['a', 'b', 'c'])
  })

  it('places a dependency before its dependents in a diamond', () => {
    const g = parse(
      [
        { id: 'a', type: 't', data: {} },
        { id: 'b', type: 't', data: {} },
        { id: 'c', type: 't', data: {} },
        { id: 'd', type: 't', data: {} },
      ],
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'a', target: 'c' },
        { id: 'e3', source: 'b', target: 'd' },
        { id: 'e4', source: 'c', target: 'd' },
      ],
    )
    const order = topologicalSort(g)
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'))
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'))
  })

  it('breaks ties by node insertion order for determinism', () => {
    const g = parse(
      [
        { id: 'root', type: 't', data: {} },
        { id: 'x', type: 't', data: {} },
        { id: 'y', type: 't', data: {} },
      ],
      [
        { id: 'e1', source: 'root', target: 'x' },
        { id: 'e2', source: 'root', target: 'y' },
      ],
    )
    expect(topologicalSort(g)).toEqual(['root', 'x', 'y'])
  })

  it('throws on a cycle', () => {
    const g = parse(
      [
        { id: 'a', type: 't', data: {} },
        { id: 'b', type: 't', data: {} },
      ],
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    )
    expect(() => topologicalSort(g)).toThrow(/cycle/)
  })

  it('includes isolated nodes', () => {
    const g = parse([{ id: 'lonely', type: 't', data: {} }], [])
    expect(topologicalSort(g)).toEqual(['lonely'])
  })
})
