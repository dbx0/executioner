import { describe, expect, it } from 'vitest'
import { reduceNodeStatus } from './useNodeStatus.js'
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

describe('reduceNodeStatus', () => {
  it('marks a node running on a running status then success on a succeeded done', () => {
    const events = [ev('status', 'a', 'running'), ev('done', 'a', 'succeeded'), ev('status', 'b', 'running')]
    expect(reduceNodeStatus(events)).toEqual({ a: 'success', b: 'running' })
  })

  it('maps failed and timeout done events to error', () => {
    const events = [ev('done', 'a', 'failed'), ev('done', 'b', 'timeout')]
    expect(reduceNodeStatus(events)).toEqual({ a: 'error', b: 'error' })
  })

  it('ignores stdout and exit-code status frames', () => {
    const events = [ev('stdout', 'a', 'line'), ev('status', 'a', '0'), ev('status', 'a', 'running')]
    expect(reduceNodeStatus(events)).toEqual({ a: 'running' })
  })

  it('returns an empty map for no events', () => {
    expect(reduceNodeStatus([])).toEqual({})
  })

  it('ignores events at or before the run baseline sequence', () => {
    // A prior run left node `a` succeeded (seq 1-2); the current run starts at
    // baseline 2 and only touches node `b` (seq 3). `a` must not be inherited.
    const events = [
      ev('status', 'a', 'running', 1),
      ev('done', 'a', 'succeeded', 2),
      ev('status', 'b', 'running', 3),
    ]
    expect(reduceNodeStatus(events, 2)).toEqual({ b: 'running' })
  })

  it('folds every event when the baseline is zero', () => {
    const events = [ev('status', 'a', 'running', 5), ev('done', 'a', 'succeeded', 6)]
    expect(reduceNodeStatus(events, 0)).toEqual({ a: 'success' })
  })
})
