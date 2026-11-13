import { describe, expect, it } from 'vitest'
import { graphSchema } from './model.js'
import { unifyStartNodes, withStartNode } from './start.js'

const graph = (nodes: unknown[], edges: unknown[] = []) => graphSchema.parse({ nodes, edges })

describe('unifyStartNodes', () => {
  it('turns the old schedule and on_create triggers into the one start node, dropping their settings', () => {
    const g = graph([
      { id: 't', type: 'on_create', data: { target_kind: 'domain' }, position: { x: 1, y: 2 } },
      { id: 's', type: 'schedule', data: { interval_seconds: 3600 } },
      { id: 'a', type: 'httpx', data: { rate_limit: 1 } },
    ])
    expect(unifyStartNodes(g).nodes).toEqual([
      { id: 't', type: 'manual', data: {}, position: { x: 1, y: 2 } },
      { id: 's', type: 'manual', data: {} },
      { id: 'a', type: 'httpx', data: { rate_limit: 1 } },
    ])
  })

  it('hands back the very same graph when there is nothing to change', () => {
    const g = graph([{ id: 't', type: 'manual', data: {} }])
    expect(unifyStartNodes(g)).toBe(g)
  })
})

describe('withStartNode', () => {
  it('leaves a graph that already starts somewhere alone', () => {
    const g = graph([{ id: 't', type: 'manual', data: {} }, { id: 'a', type: 'httpx', data: {} }], [{ id: 'e', source: 't', target: 'a' }])
    expect(withStartNode(g)).toBe(g)
  })

  it('adds a start node wired to every node nothing leads into', () => {
    const g = graph(
      [{ id: 'a', type: 'subfinder', data: {} }, { id: 'b', type: 'httpx', data: {} }, { id: 'c', type: 'whois', data: {} }],
      [{ id: 'e1', source: 'a', target: 'b' }],
    )
    const out = withStartNode(g)
    expect(out.nodes[0]).toMatchObject({ id: 'start', type: 'manual', data: {} })
    expect(out.nodes).toHaveLength(4)
    const fromStart = out.edges.filter((e) => e.source === 'start').map((e) => e.target)
    // b is reached through a, so it is not an entry point.
    expect(fromStart).toEqual(['a', 'c'])
    expect(new Set(out.edges.map((e) => e.id)).size).toBe(out.edges.length)
  })

  it('counts an old trigger as a start, rather than adding a second one', () => {
    const g = graph([{ id: 't', type: 'on_create', data: { target_kind: 'ip' } }, { id: 'a', type: 'nmap', data: {} }], [{ id: 'e', source: 't', target: 'a' }])
    const out = withStartNode(g)
    expect(out.nodes.map((n) => [n.id, n.type])).toEqual([['t', 'manual'], ['a', 'nmap']])
  })

  it('picks an id nothing else uses', () => {
    const out = withStartNode(graph([{ id: 'start', type: 'httpx', data: {} }]))
    expect(out.nodes[0]?.id).toBe('start-2')
    expect(out.edges).toMatchObject([{ source: 'start-2', target: 'start' }])
  })

  it('places the start node to the left of the nodes it leads into, when they have places', () => {
    const out = withStartNode(
      graph([
        { id: 'a', type: 'whois', data: {}, position: { x: 400, y: 100 } },
        { id: 'b', type: 'httpx', data: {}, position: { x: 400, y: 300 } },
      ]),
    )
    expect((out.nodes[0] as { position?: unknown }).position).toEqual({ x: 120, y: 200 })
  })

  it('does not invent a start for an empty graph', () => {
    const g = graph([])
    expect(withStartNode(g)).toBe(g)
  })
})
