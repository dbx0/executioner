import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { actionRoutes } from './actions.js'

let dir: string
let project: Project
let onChange: () => void

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-actions-'))
  project = createProject(dir, { name: 'test' })
  project.workflows.create('Domain recon', JSON.stringify({ nodes: [], edges: [] }), { id: 'wf-1' })
  // A new install ships one default; these tests start from none.
  for (const shipped of project.defaultActions.list()) project.defaultActions.remove(shipped.id)
  onChange = vi.fn<() => void>()
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const app = () => actionRoutes({ project, nodeTypes: () => new Set(['httpx', 'tls_cert']), onChange })

const post = (body: unknown): Promise<Response> =>
  Promise.resolve(app().request('/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

const patch = (path: string, body: unknown): Promise<Response> =>
  Promise.resolve(app().request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

interface Listed {
  defaults: Array<{ id: string; enabledHere: boolean; workflowId: string | null }>
  engagement: Array<{ id: string; nodeType: string | null; enabled: boolean }>
}
const list = async (): Promise<Listed> => (await app().request('/actions')).json() as Promise<Listed>

describe('POST /actions', () => {
  it('creates a default that runs a workflow when a kind of target is added', async () => {
    const res = await post({ scope: 'default', kind: 'on_create', targetKind: 'domain', workflowId: 'wf-1', inScopeOnly: true })
    expect(res.status).toBe(201)
    expect(project.defaultActions.list()).toMatchObject([{ workflowId: 'wf-1', targetKind: 'domain', inScopeOnly: true }])
    expect(project.schedules.list()).toHaveLength(0)
    expect(onChange).toHaveBeenCalled()
  })

  it('creates an engagement action that runs a tool with its options', async () => {
    const res = await post({ scope: 'engagement', kind: 'on_create', targetKind: 'subdomain', nodeType: 'httpx', nodeParams: { rate_limit: 1 } })
    expect(res.status).toBe(201)
    expect(project.schedules.list()).toMatchObject([{ workflowId: null, nodeType: 'httpx', nodeParams: { rate_limit: 1 } }])
  })

  it('refuses an action that names both a workflow and a tool, or neither', async () => {
    const base = { scope: 'engagement', kind: 'on_create', targetKind: 'domain' }
    expect((await post({ ...base, workflowId: 'wf-1', nodeType: 'httpx' })).status).toBe(400)
    expect((await post(base)).status).toBe(400)
  })

  it('refuses a workflow or a tool that does not exist', async () => {
    const base = { scope: 'engagement', kind: 'on_create', targetKind: 'domain' }
    expect((await post({ ...base, workflowId: 'nope' })).status).toBe(400)
    expect((await post({ ...base, nodeType: 'not-a-tool' })).status).toBe(400)
  })

  it('refuses a scheduled default: a timer needs an engagement and a target to run in', async () => {
    const res = await post({ scope: 'default', kind: 'interval', intervalSeconds: 3600, workflowId: 'wf-1' })
    expect(res.status).toBe(400)
  })

  it('refuses a tool on a timer with no target to run it against', async () => {
    const res = await post({ scope: 'engagement', kind: 'interval', intervalSeconds: 3600, nodeType: 'tls_cert' })
    expect(res.status).toBe(400)
  })
})

describe('GET /actions', () => {
  it('lists defaults and the engagement own actions apart, saying which defaults are on here', async () => {
    const on = project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    const off = project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'ip' })
    project.defaultOverrides.set(off.id, false)
    project.schedules.create({ nodeType: 'httpx', kind: 'on_create', targetKind: 'subdomain' })

    const body = await list()
    expect(body.defaults.map((a) => [a.id, a.enabledHere])).toEqual([[on.id, true], [off.id, false]])
    expect(body.engagement).toMatchObject([{ nodeType: 'httpx', enabled: true }])
  })
})

describe('a default that ships switched off', () => {
  it('lists as off here, and turns on for this engagement alone', async () => {
    const action = project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain', enabled: false })
    expect((await list()).defaults).toMatchObject([{ id: action.id, enabledHere: false }])

    await patch(`/actions/default/${action.id}`, { enabled: true })
    expect((await list()).defaults).toMatchObject([{ id: action.id, enabledHere: true }])
    // The default itself is untouched, so other engagements still see it off.
    expect(project.defaultActions.get(action.id)?.enabled).toBe(false)
  })
})

describe('PATCH /actions/:scope/:id', () => {
  it('switches a default off for this engagement only, leaving the default itself enabled', async () => {
    const action = project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    expect((await patch(`/actions/default/${action.id}`, { enabled: false })).status).toBe(200)
    expect(project.defaultOverrides.get(action.id)).toBe(false)
    expect(project.defaultActions.get(action.id)?.enabled).toBe(true)

    await patch(`/actions/default/${action.id}`, { enabled: true })
    expect(project.defaultOverrides.get(action.id)).toBe(true)
  })

  it('switches an engagement action off', async () => {
    const action = project.schedules.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    await patch(`/actions/engagement/${action.id}`, { enabled: false })
    expect(project.schedules.get(action.id)?.enabled).toBe(false)
  })

  it('answers 404 for an action that is not there', async () => {
    expect((await patch('/actions/default/nope', { enabled: false })).status).toBe(404)
    expect((await patch('/actions/engagement/nope', { enabled: false })).status).toBe(404)
  })
})

describe('DELETE /actions/:scope/:id', () => {
  it('removes a default for everyone and forgets that it was switched off here', async () => {
    const action = project.defaultActions.create({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain' })
    project.defaultOverrides.set(action.id, false)
    const res = await app().request(`/actions/default/${action.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(project.defaultActions.list()).toHaveLength(0)
    expect(project.defaultOverrides.get(action.id)).toBeUndefined()
  })
})
