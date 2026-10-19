import type { Edge, Node } from 'reactflow'
import { describe, expect, it } from 'vitest'
import { layoutGraph } from './autolayout.js'

function node(id: string): Node {
  return { id, type: 'tool', position: { x: 0, y: 0 }, data: {} }
}

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target }
}

function byId(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((n) => [n.id, n]))
}

describe('layoutGraph', () => {
  it('lays a linear chain out in increasing x', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const out = byId(layoutGraph(nodes, edges))
    expect(out.get('a')!.position).toEqual({ x: 80, y: 120 })
    expect(out.get('b')!.position).toEqual({ x: 340, y: 120 })
    expect(out.get('c')!.position).toEqual({ x: 600, y: 120 })
  })

  it('places both children of a branch in the next layer at different y', () => {
    const nodes = [node('root'), node('left'), node('right')]
    const edges = [edge('root', 'left'), edge('root', 'right')]
    const out = byId(layoutGraph(nodes, edges))
    expect(out.get('root')!.position).toEqual({ x: 80, y: 120 })
    const left = out.get('left')!.position
    const right = out.get('right')!.position
    // same layer (column)
    expect(left.x).toBe(340)
    expect(right.x).toBe(340)
    // stacked at different rows
    expect(left.y).not.toBe(right.y)
    expect(new Set([left.y, right.y])).toEqual(new Set([120, 260]))
  })

  it('lays out a diamond with the join one layer past the branches', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')]
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]
    const out = byId(layoutGraph(nodes, edges))
    expect(out.get('a')!.position.x).toBe(80)
    expect(out.get('b')!.position.x).toBe(340)
    expect(out.get('c')!.position.x).toBe(340)
    // longest path: d sits one layer past b/c, not two past a
    expect(out.get('d')!.position.x).toBe(600)
    expect(out.get('b')!.position.y).not.toBe(out.get('c')!.position.y)
  })

  it('returns [] for an empty graph', () => {
    expect(layoutGraph([], [])).toEqual([])
  })

  it('does not throw on a cycle and returns every node exactly once', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
    let out: Node[] = []
    expect(() => {
      out = layoutGraph(nodes, edges)
    }).not.toThrow()
    expect(out).toHaveLength(3)
    expect(new Set(out.map((n) => n.id))).toEqual(new Set(['a', 'b', 'c']))
    for (const n of out) {
      expect(Number.isFinite(n.position.x)).toBe(true)
      expect(Number.isFinite(n.position.y)).toBe(true)
    }
  })

  it('does not mutate the input nodes', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('a', 'b')]
    const out = layoutGraph(nodes, edges)
    expect(nodes[0]!.position).toEqual({ x: 0, y: 0 })
    expect(out[0]).not.toBe(nodes[0])
  })
})
