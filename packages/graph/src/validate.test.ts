import { describe, expect, it } from 'vitest'
import { graphSchema } from './model.js'
import { validateGraph } from './validate.js'

describe('validateGraph', () => {
  it('accepts a well-formed acyclic graph', () => {
    const g = graphSchema.parse({
      nodes: [{ id: 'a', type: 't', data: {} }, { id: 'b', type: 't', data: {} }],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    })
    expect(validateGraph(g)).toEqual({ ok: true })
  })

  it('rejects an edge whose source does not exist', () => {
    const g = graphSchema.parse({
      nodes: [{ id: 'b', type: 't', data: {} }],
      edges: [{ id: 'e', source: 'ghost', target: 'b' }],
    })
    const result = validateGraph(g)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/ghost/)
  })

  it('rejects an edge whose target does not exist', () => {
    const g = graphSchema.parse({
      nodes: [{ id: 'a', type: 't', data: {} }],
      edges: [{ id: 'e', source: 'a', target: 'ghost' }],
    })
    expect(validateGraph(g).ok).toBe(false)
  })

  it('rejects a cyclic graph', () => {
    const g = graphSchema.parse({
      nodes: [{ id: 'a', type: 't', data: {} }, { id: 'b', type: 't', data: {} }],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    })
    const result = validateGraph(g)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => /cycle/.test(e))).toBe(true)
  })

  it('rejects duplicate node ids', () => {
    const g = graphSchema.parse({
      nodes: [{ id: 'a', type: 't', data: {} }, { id: 'a', type: 't', data: {} }],
      edges: [],
    })
    expect(validateGraph(g).ok).toBe(false)
  })
})
