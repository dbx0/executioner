import { describe, expect, it } from 'vitest'
import { MAX_OUTPUT_CHARS, reduceNodeOutputs } from './useNodeOutputs.js'
import type { EngineEvent } from '../../lib/events.js'

let seqCounter = 0
const ev = (type: EngineEvent['type'], nodeId: string, data: string, seq?: number): EngineEvent => ({
  type,
  executionId: 'e',
  nodeId,
  data,
  seq: seq ?? (seqCounter += 1),
  at: '',
})

describe('reduceNodeOutputs', () => {
  it('concatenates stdout frames per node in seq order', () => {
    const events = [
      ev('stdout', 'a', 'hello '),
      ev('stdout', 'b', 'world'),
      ev('stdout', 'a', 'there'),
    ]
    expect(reduceNodeOutputs(events)).toEqual({ a: 'hello there', b: 'world' })
  })

  it('ignores frames at or before the run baseline sequence', () => {
    const events = [
      ev('stdout', 'a', 'old', 1),
      ev('stdout', 'a', 'new', 2),
    ]
    expect(reduceNodeOutputs(events, 1)).toEqual({ a: 'new' })
  })

  it('ignores non-stdout frames (status, done, stderr, agent)', () => {
    const events = [
      ev('status', 'a', 'running'),
      ev('stderr', 'a', 'warn'),
      ev('done', 'a', 'succeeded'),
      ev('agent', 'a', 'thinking'),
      ev('stdout', 'a', 'captured'),
    ]
    expect(reduceNodeOutputs(events)).toEqual({ a: 'captured' })
  })

  it('returns an empty map for no events', () => {
    expect(reduceNodeOutputs([])).toEqual({})
  })

  it('caps the accumulated text to the last MAX_OUTPUT_CHARS characters', () => {
    const first = 'x'.repeat(MAX_OUTPUT_CHARS)
    const tail = 'TAIL'
    const events = [ev('stdout', 'a', first), ev('stdout', 'a', tail)]
    const captured = reduceNodeOutputs(events).a ?? ''
    expect(captured).toHaveLength(MAX_OUTPUT_CHARS)
    expect(captured.endsWith(tail)).toBe(true)
    // The oldest characters were sliced from the front.
    expect(captured.startsWith('x')).toBe(true)
    expect(captured).toBe((first + tail).slice(-MAX_OUTPUT_CHARS))
  })
})
