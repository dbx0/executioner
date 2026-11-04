import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type ProjectDatabase } from './index.js'
import { ScheduleRepository } from './schedules.js'

let db: ProjectDatabase
let schedules: ScheduleRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  schedules = new ScheduleRepository(db)
})

describe('ScheduleRepository', () => {
  it('creates and gets an interval schedule with defaults', () => {
    const s = schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 900 })
    expect(s.kind).toBe('interval')
    expect(s.intervalSeconds).toBe(900)
    expect(s.enabled).toBe(true)
    expect(s.targetId).toBeNull()
    expect(schedules.get(s.id)?.intervalSeconds).toBe(900)
  })

  it('creates an on_create schedule carrying its target kind', () => {
    const s = schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    expect(s.kind).toBe('on_create')
    expect(s.targetKind).toBe('domain')
    expect(s.intervalSeconds).toBeNull()
  })

  it('defaults the backend profile to null and round-trips one when given', () => {
    const plain = schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 60 })
    expect(plain.backendProfileId).toBeNull()

    const onKali = schedules.create({
      workflowId: 'wf-1',
      kind: 'interval',
      intervalSeconds: 60,
      backendProfileId: 'kali-1',
    })
    expect(onKali.backendProfileId).toBe('kali-1')
    expect(schedules.get(onKali.id)?.backendProfileId).toBe('kali-1')
  })

  it('lists schedules in creation order', () => {
    schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 60 })
    schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'ip' })
    expect(schedules.list()).toHaveLength(2)
  })

  it('toggles enabled', () => {
    const s = schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 60 })
    const updated = schedules.setEnabled(s.id, false)
    expect(updated?.enabled).toBe(false)
    expect(schedules.get(s.id)?.enabled).toBe(false)
  })

  it('removes a schedule', () => {
    const s = schedules.create({ workflowId: 'wf-1', kind: 'interval', intervalSeconds: 60 })
    schedules.remove(s.id)
    expect(schedules.get(s.id)).toBeUndefined()
  })
})
