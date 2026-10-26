import { describe, expect, it } from 'vitest'
import { scheduleDefaultsFromGraph } from './schedule-defaults.js'

const node = (type: string, data: Record<string, unknown> = {}) => ({ id: type, type, data })

describe('scheduleDefaultsFromGraph', () => {
  it('reads the interval from a Schedule Trigger', () => {
    expect(scheduleDefaultsFromGraph({ nodes: [node('schedule', { interval_seconds: 120 })], edges: [] })).toEqual({
      kind: 'interval',
      intervalSeconds: 120,
    })
  })

  it('falls back to an hour for a missing or invalid interval', () => {
    expect(scheduleDefaultsFromGraph({ nodes: [node('schedule')], edges: [] })).toEqual({ kind: 'interval', intervalSeconds: 3600 })
    expect(scheduleDefaultsFromGraph({ nodes: [node('schedule', { interval_seconds: -5 })], edges: [] })).toEqual({
      kind: 'interval',
      intervalSeconds: 3600,
    })
  })

  it('reads the target kind from an On Create Trigger', () => {
    expect(scheduleDefaultsFromGraph({ nodes: [node('on_create', { target_kind: 'subdomain' })], edges: [] })).toEqual({
      kind: 'on_create',
      targetKind: 'subdomain',
    })
  })

  it('returns undefined for a workflow without a schedule-type trigger', () => {
    expect(scheduleDefaultsFromGraph({ nodes: [node('manual'), node('if')], edges: [] })).toBeUndefined()
  })
})
