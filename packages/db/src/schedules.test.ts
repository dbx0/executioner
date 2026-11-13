import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, openGlobalDatabase, type ProjectDatabase } from './index.js'
import { DefaultActionRepository, DefaultOverrides, ScheduleRepository, seedDefaultActions } from './schedules.js'
import { seedStarterWorkflows } from './starter-workflows.js'
import { WorkflowRepository } from './workflows.js'

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

  it('stores an action that runs a single tool instead of a workflow, with its options', () => {
    const s = schedules.create({ nodeType: 'httpx', nodeParams: { rate_limit: 1 }, kind: 'on_create', targetKind: 'subdomain' })
    expect(s.workflowId).toBeNull()
    expect(schedules.get(s.id)).toMatchObject({ workflowId: null, nodeType: 'httpx', nodeParams: { rate_limit: 1 } })
  })

  it('keeps a workflow action free of tool fields', () => {
    const s = schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    expect(schedules.get(s.id)).toMatchObject({ workflowId: 'wf-1', nodeType: null, nodeParams: null })
  })

  it('remembers whether an action is limited to in-scope targets, off unless asked', () => {
    const open = schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    const scoped = schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain', inScopeOnly: true })
    expect(schedules.get(open.id)?.inScopeOnly).toBe(false)
    expect(schedules.get(scoped.id)?.inScopeOnly).toBe(true)
  })

  it('does not drop a tool action when an unrelated workflow is deleted', () => {
    const tool = schedules.create({ nodeType: 'httpx', kind: 'on_create', targetKind: 'subdomain' })
    schedules.removeForWorkflow('wf-1')
    expect(schedules.get(tool.id)).toBeDefined()
  })
})

describe('default actions, shared by every engagement', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'exe-defaults-'))
    return () => rmSync(home, { recursive: true, force: true })
  })

  it('live in the user-level database, so a second engagement sees them', () => {
    const path = join(home, 'global.sqlite')
    const first = openGlobalDatabase(path)
    const created = new DefaultActionRepository(first).create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain', inScopeOnly: true })
    first.close()

    const second = openGlobalDatabase(path)
    expect(new DefaultActionRepository(second).list()).toEqual([created])
    second.close()
  })

  it('lets one engagement switch a default on or off without touching the default itself', () => {
    const overrides = new DefaultOverrides(db)
    // No choice made here yet: the default's own setting stands.
    expect(overrides.get('a1')).toBeUndefined()
    overrides.set('a1', false)
    overrides.set('a2', true)
    expect(overrides.get('a1')).toBe(false)
    expect(overrides.get('a2')).toBe(true)
    // A fresh handle on the same engagement still knows.
    expect(new DefaultOverrides(db).get('a1')).toBe(false)
    overrides.clear('a1')
    expect(overrides.get('a1')).toBeUndefined()
  })

  it('ships one default, basic recon on every new in-scope domain, switched off', () => {
    const global = openGlobalDatabase(join(home, 'global.sqlite'))
    seedStarterWorkflows(global)
    expect(seedDefaultActions(global)).toBe(1)
    expect(new DefaultActionRepository(global).list()).toMatchObject([
      { workflowId: 'starter-domain-recon', kind: 'on_create', targetKind: 'domain', inScopeOnly: true, enabled: false },
    ])
    global.close()
  })

  it('hands the shipped default out once, so deleting it sticks', () => {
    const global = openGlobalDatabase(join(home, 'global.sqlite'))
    seedStarterWorkflows(global)
    seedDefaultActions(global)
    const repo = new DefaultActionRepository(global)
    for (const action of repo.list()) repo.remove(action.id)
    expect(seedDefaultActions(global)).toBe(0)
    expect(repo.list()).toHaveLength(0)
    global.close()
  })

  it('ships no default when the basic recon workflow is not there to run', () => {
    const global = openGlobalDatabase(join(home, 'global.sqlite'))
    seedStarterWorkflows(global)
    new WorkflowRepository(global).remove('starter-domain-recon')
    expect(seedDefaultActions(global)).toBe(0)
    global.close()
  })
})
