import { describe, expect, it } from 'vitest'
import { parseEngineEvent } from './events.js'

describe('parseEngineEvent', () => {
  it('parses a well-formed event message', () => {
    const raw = JSON.stringify({ type: 'stdout', executionId: 'e1', nodeId: 'n1', data: 'hi', seq: 3, at: 'now' })
    expect(parseEngineEvent(raw)).toEqual({
      type: 'stdout',
      executionId: 'e1',
      nodeId: 'n1',
      data: 'hi',
      seq: 3,
      at: 'now',
    })
  })

  it('returns undefined for malformed json', () => {
    expect(parseEngineEvent('not json')).toBeUndefined()
  })

  it('returns undefined for a message missing required fields', () => {
    expect(parseEngineEvent(JSON.stringify({ type: 'stdout' }))).toBeUndefined()
  })

  it('parses a change event', () => {
    const raw = JSON.stringify({ type: 'change', executionId: '', nodeId: 'targets', data: '{}', seq: 1, at: 'now' })
    expect(parseEngineEvent(raw)?.type).toBe('change')
  })
})
