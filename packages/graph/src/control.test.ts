import { describe, expect, it } from 'vitest'
import { graphSchema } from './model.js'
import { buildAdjacency } from './adjacency.js'
import { propagateSkip, loopBody, evaluateIf, evaluateIfOutcome } from './control.js'

describe('evaluateIf', () => {
  it('returns the true branch when the expression is truthy', () => {
    expect(evaluateIf('data.count > 0', { count: 5 })).toBe('true')
  })

  it('returns the false branch when the expression is falsy', () => {
    expect(evaluateIf('data.count > 0', { count: 0 })).toBe('false')
  })

  it('returns false on an expression error rather than throwing', () => {
    expect(evaluateIf('data.missing.deep', {})).toBe('false')
  })

  it('supports string comparison', () => {
    expect(evaluateIf('data.status === "open"', { status: 'open' })).toBe('true')
  })
})

describe('propagateSkip', () => {
  it('skips nodes only reachable through the non-taken branch', () => {
    const g = graphSchema.parse({
      nodes: [
        { id: 'if', type: 'if', data: {} },
        { id: 't', type: 'x', data: {} },
        { id: 'f', type: 'x', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'if', target: 't', sourceHandle: 'true' },
        { id: 'e2', source: 'if', target: 'f', sourceHandle: 'false' },
      ],
    })
    const adj = buildAdjacency(g)
    const skipped = new Set<string>()
    propagateSkip('if', 'true', adj, skipped)
    expect(skipped.has('f')).toBe(true)
    expect(skipped.has('t')).toBe(false)
  })

  it('does not skip a node also reachable through an unlabelled edge', () => {
    const g = graphSchema.parse({
      nodes: [
        { id: 'if', type: 'if', data: {} },
        { id: 'other', type: 'x', data: {} },
        { id: 'shared', type: 'x', data: {} },
        { id: 'f', type: 'x', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'if', target: 'f', sourceHandle: 'false' },
        { id: 'e2', source: 'f', target: 'shared' },
        { id: 'e3', source: 'other', target: 'shared' },
      ],
    })
    const adj = buildAdjacency(g)
    const skipped = new Set<string>()
    propagateSkip('if', 'true', adj, skipped)
    expect(skipped.has('f')).toBe(true)
    // 'shared' is still reachable from 'other', so it must not be skipped.
    expect(skipped.has('shared')).toBe(false)
  })
})

describe('loopBody', () => {
  it('returns nodes reachable through non-done edges', () => {
    const g = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: {} },
        { id: 'body1', type: 'x', data: {} },
        { id: 'body2', type: 'x', data: {} },
        { id: 'after', type: 'x', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'loop', target: 'body1' },
        { id: 'e2', source: 'body1', target: 'body2' },
        { id: 'e3', source: 'loop', target: 'after', sourceHandle: 'done' },
      ],
    })
    const adj = buildAdjacency(g)
    const body = loopBody('loop', adj)
    expect([...body].sort()).toEqual(['body1', 'body2'])
    expect(body.has('after')).toBe(false)
  })

  it('stops at a nested done edge and does not recurse into it', () => {
    const g = graphSchema.parse({
      nodes: [
        { id: 'loop', type: 'loop', data: {} },
        { id: 'body', type: 'x', data: {} },
        { id: 'after', type: 'x', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'loop', target: 'body' },
        { id: 'e2', source: 'body', target: 'after', sourceHandle: 'done' },
      ],
    })
    const adj = buildAdjacency(g)
    const body = loopBody('loop', adj)
    expect([...body]).toEqual(['body'])
  })
})

describe('evaluateIfOutcome', () => {
  it('reports why a condition could not be evaluated', () => {
    // What a `{{ … }}` template compiles to: a syntax error, previously swallowed.
    const out = evaluateIfOutcome('{{ nodes.probe.alive }}', {})
    expect(out.branch).toBe('false')
    expect(out.error).toBeDefined()
  })

  it('separates a genuine false from a broken condition', () => {
    expect(evaluateIfOutcome('data.alive', { alive: false })).toEqual({ branch: 'false' })
    expect(evaluateIfOutcome('data.alive', { alive: true })).toEqual({ branch: 'true' })
  })

  it('treats an empty condition as an error, not as false', () => {
    expect(evaluateIfOutcome('   ', {}).error).toBe('the condition is empty')
  })

  it('still takes the false branch on an error, so one bad node cannot halt a run', () => {
    expect(evaluateIfOutcome('this is not javascript', {}).branch).toBe('false')
  })
})
