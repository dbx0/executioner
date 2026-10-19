import { describe, it, expect } from 'vitest'
import { parseWorkflowFile } from './workflow-io.js'

describe('parseWorkflowFile', () => {
  it('parses a valid workflow export with a name', () => {
    const text = JSON.stringify({
      name: 'My workflow',
      graph: { nodes: [{ id: 'a' }], edges: [] },
    })
    const result = parseWorkflowFile(text)
    expect(result).not.toBeNull()
    expect(result?.name).toBe('My workflow')
    expect(result?.graph.nodes).toHaveLength(1)
    expect(result?.graph.edges).toHaveLength(0)
  })

  it('parses a valid export without a name', () => {
    const text = JSON.stringify({ graph: { nodes: [], edges: [] } })
    const result = parseWorkflowFile(text)
    expect(result).not.toBeNull()
    expect(result?.name).toBeUndefined()
    expect(result?.graph.edges).toEqual([])
  })

  it('returns null when the graph is missing', () => {
    expect(parseWorkflowFile(JSON.stringify({ name: 'no graph' }))).toBeNull()
  })

  it('returns null when nodes/edges are not arrays', () => {
    expect(parseWorkflowFile(JSON.stringify({ graph: { nodes: {}, edges: 1 } }))).toBeNull()
  })

  it('returns null on non-JSON input', () => {
    expect(parseWorkflowFile('not json at all')).toBeNull()
  })
})
