import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { useGraphHistory } from './useGraphHistory.js'

const node = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} }) as Node
const graph = (id: string): { nodes: Node[]; edges: Edge[] } => ({ nodes: [node(id)], edges: [] })
const ids = (snap: { nodes: Node[] } | null): string[] => (snap ? snap.nodes.map((n) => n.id) : [])

describe('useGraphHistory', () => {
  it('records, undoes and redoes distinct snapshots with coalescing disabled', () => {
    const { result } = renderHook(() => useGraphHistory({ coalesceMs: 0 }))

    // Baseline A, then B, then C: present is C, past holds [A, B].
    act(() => result.current.record(graph('A').nodes, graph('A').edges))
    act(() => result.current.record(graph('B').nodes, graph('B').edges))
    act(() => result.current.record(graph('C').nodes, graph('C').edges))

    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    let undone: ReturnType<typeof result.current.undo> = null
    act(() => {
      undone = result.current.undo()
    })
    expect(ids(undone)).toEqual(['B'])

    act(() => {
      undone = result.current.undo()
    })
    expect(ids(undone)).toEqual(['A'])
    expect(result.current.canRedo).toBe(true)

    let redone: ReturnType<typeof result.current.redo> = null
    act(() => {
      redone = result.current.redo()
    })
    expect(ids(redone)).toEqual(['B'])
  })

  it('clears the redo future when a new snapshot is recorded after an undo', () => {
    const { result } = renderHook(() => useGraphHistory({ coalesceMs: 0 }))

    act(() => result.current.record(graph('A').nodes, graph('A').edges))
    act(() => result.current.record(graph('B').nodes, graph('B').edges))
    act(() => result.current.record(graph('C').nodes, graph('C').edges))

    act(() => {
      result.current.undo()
    })
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.record(graph('D').nodes, graph('D').edges))
    expect(result.current.canRedo).toBe(false)
  })

  it('coalesces rapid records into a single history entry', () => {
    const { result } = renderHook(() => useGraphHistory({ coalesceMs: 100000 }))

    // Baseline A, then two rapid records B then C. B pushes A; C coalesces onto B.
    act(() => result.current.record(graph('A').nodes, graph('A').edges))
    act(() => result.current.record(graph('B').nodes, graph('B').edges))
    act(() => result.current.record(graph('C').nodes, graph('C').edges))

    expect(result.current.canUndo).toBe(true)

    let undone: ReturnType<typeof result.current.undo> = null
    act(() => {
      undone = result.current.undo()
    })
    // A single undo returns the baseline: the burst collapsed to one entry.
    expect(ids(undone)).toEqual(['A'])
    expect(result.current.canUndo).toBe(false)
  })

  it('returns null when there is nothing to undo or redo', () => {
    const { result } = renderHook(() => useGraphHistory({ coalesceMs: 0 }))

    expect(result.current.undo()).toBeNull()
    expect(result.current.redo()).toBeNull()
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('reset replaces the baseline and clears both stacks', () => {
    const { result } = renderHook(() => useGraphHistory({ coalesceMs: 0 }))

    act(() => result.current.record(graph('A').nodes, graph('A').edges))
    act(() => result.current.record(graph('B').nodes, graph('B').edges))

    act(() => result.current.reset(graph('Z').nodes, graph('Z').edges))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)

    // After reset the next record pushes the reset baseline, so undo returns Z.
    act(() => result.current.record(graph('Y').nodes, graph('Y').edges))
    let undone: ReturnType<typeof result.current.undo> = null
    act(() => {
      undone = result.current.undo()
    })
    expect(ids(undone)).toEqual(['Z'])
  })

  it('does not corrupt stored history when the live arrays are later mutated', () => {
    const { result } = renderHook(() => useGraphHistory({ coalesceMs: 0 }))

    const live = graph('A')
    act(() => result.current.record(live.nodes, live.edges))
    act(() => result.current.record(graph('B').nodes, graph('B').edges))

    // Mutate the original array the caller handed in.
    live.nodes[0]!.id = 'MUTATED'

    let undone: ReturnType<typeof result.current.undo> = null
    act(() => {
      undone = result.current.undo()
    })
    expect(ids(undone)).toEqual(['A'])
  })
})
