import { describe, expect, it } from 'vitest'
import { NodeExecutionStatus, nodeExecutionStatusSchema } from './execution.js'

describe('NodeExecutionStatus', () => {
  it('exposes the four terminal-and-running states', () => {
    expect(NodeExecutionStatus.Running).toBe('running')
    expect(NodeExecutionStatus.Succeeded).toBe('succeeded')
    expect(NodeExecutionStatus.Failed).toBe('failed')
    expect(NodeExecutionStatus.Timeout).toBe('timeout')
  })

  it('parses a valid status and rejects an unknown one', () => {
    expect(nodeExecutionStatusSchema.parse('running')).toBe('running')
    expect(() => nodeExecutionStatusSchema.parse('queued')).toThrow()
  })
})
