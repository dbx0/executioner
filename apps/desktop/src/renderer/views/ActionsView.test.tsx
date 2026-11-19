import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { Action, ActionList } from '../api/actions.js'

const action = (over: Partial<Action> = {}): Action => ({
  id: 'a1',
  workflowId: 'wf-1',
  nodeType: null,
  nodeParams: null,
  targetId: null,
  kind: 'on_create',
  intervalSeconds: null,
  targetKind: 'domain',
  backendProfileId: null,
  inScopeOnly: true,
  enabled: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

const LISTED: ActionList = {
  defaults: [{ ...action({ id: 'd1' }), enabledHere: true }],
  engagement: [
    action({ id: 'e1', kind: 'interval', intervalSeconds: 86_400, targetKind: null, targetId: 't1', backendProfileId: 'b1', inScopeOnly: false }),
    action({ id: 'e2', workflowId: null, nodeType: 'httpx', nodeParams: {}, targetKind: 'subdomain', inScopeOnly: false, enabled: false }),
  ],
}

const actions = {
  list: vi.fn(() => Promise.resolve(LISTED)),
  create: vi.fn(() => Promise.resolve(action())),
  setEnabled: vi.fn(() => Promise.resolve({})),
  remove: vi.fn(() => Promise.resolve({})),
}
vi.mock('../api/actions.js', () => ({ actionsApi: () => actions }))
vi.mock('../api/workflows.js', () => ({
  workflowsApi: () => ({
    list: () => Promise.resolve([{ id: 'wf-1', name: 'Domain recon', updated_at: '' }]),
    get: () => Promise.resolve({ id: 'wf-1', name: 'Domain recon', graph: { nodes: [], edges: [] } }),
  }),
}))
vi.mock('../api/targets.js', () => ({ targetsApi: () => ({ list: () => Promise.resolve([{ id: 't1', kind: 'domain', value: 'acme.com' }]) }) }))
vi.mock('../api/backends.js', () => ({ backendsApi: () => ({ list: () => Promise.resolve([{ id: 'b1', name: 'kali', kind: 'ssh' }]) }) }))
vi.mock('../api/nodes.js', () => ({
  nodesApi: () => ({
    list: () => Promise.resolve([{ id: 'httpx', name: 'httpx', category: 'web', description: '', accepts: ['domain'], params: {} }]),
  }),
}))

const { ActionsView } = await import('./ActionsView.js')

beforeEach(() => {
  vi.clearAllMocks()
  actions.list.mockResolvedValue(LISTED)
  useApp.setState({ client: {} as AxiosInstance, engagementName: 'Acme Corp' })
})

/** The list row that mentions `text`. */
const rowWith = async (text: RegExp): Promise<HTMLElement> => (await screen.findByText(text)).closest('li') as HTMLElement

describe('ActionsView', () => {
  it('reads each action as a trigger and what it runs', async () => {
    render(<ActionsView />)
    const byDefault = await rowWith(/Only if it is in scope/)
    expect(byDefault.textContent).toContain('When a Domain is added')
    expect(byDefault.textContent).toContain('Run Domain recon')
    expect(byDefault.textContent).toContain("Workflow · on the engagement's default backend")

    const timed = await rowWith(/Every 24 hours/)
    expect(timed.textContent).toContain('Run Domain recon on acme.com')
    expect(timed.textContent).toContain('Workflow · on kali')

    const tool = await rowWith(/Run httpx/)
    expect(tool.textContent).toContain('When a Subdomain is added')
    expect(tool.textContent).toContain('Tool ·')
    expect(tool.textContent).toContain('switched off')
  })

  it('switches a default off for this engagement, not for everyone', async () => {
    render(<ActionsView />)
    const row = await rowWith(/Only if it is in scope/)
    fireEvent.click(within(row).getByRole('switch'))
    await waitFor(() => expect(actions.setEnabled).toHaveBeenCalledWith('default', 'd1', false))
  })

  it('asks before deleting a default, since that removes it from every engagement', async () => {
    render(<ActionsView />)
    const row = await rowWith(/Only if it is in scope/)
    fireEvent.click(within(row).getByRole('button', { name: /delete action/i }))
    expect(actions.remove).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /delete for every engagement/i }))
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith('default', 'd1'))
  })

  it('deletes an engagement action straight away', async () => {
    render(<ActionsView />)
    const row = await rowWith(/Every 24 hours/)
    fireEvent.click(within(row).getByRole('button', { name: /delete action/i }))
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith('engagement', 'e1'))
  })

  it('will not create an action until it knows what to run', async () => {
    render(<ActionsView />)
    await screen.findByText(/Every 24 hours/)
    fireEvent.click(screen.getByRole('button', { name: /new action/i }))
    const panel = await screen.findByRole('complementary', { name: /new action/i })
    expect(within(panel).getByRole('button', { name: /create action/i })).toHaveProperty('disabled', true)
    expect(within(panel).getByRole('status').textContent).toMatch(/pick the workflow/i)
  })

  it('says so when there are no actions of a kind yet', async () => {
    actions.list.mockResolvedValue({ defaults: [], engagement: [] })
    render(<ActionsView />)
    expect(await screen.findByText(/No defaults yet/)).toBeTruthy()
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy()
  })

  it('offers suggestions for what is not set up, and opens one prefilled', async () => {
    actions.list.mockResolvedValue({ defaults: [], engagement: [] })
    render(<ActionsView />)
    // httpx is the only tool here and no starter workflow exists, so one suggestion fits.
    fireEvent.click(await screen.findByRole('button', { name: /probe every new subdomain/i }))
    const panel = await screen.findByRole('complementary', { name: /new action/i })
    expect(panel.textContent).toContain('When a Subdomain in scope is added to any engagement, run the tool httpx on it.')
    expect(within(panel).getByRole('button', { name: /create action/i })).toHaveProperty('disabled', false)
  })

  it('does not suggest what an action already covers', async () => {
    render(<ActionsView />)
    await screen.findByText(/Every 24 hours/)
    // LISTED already has an httpx action on new subdomains.
    expect(screen.queryByRole('button', { name: /probe every new subdomain/i })).toBeNull()
  })

  it('offers the in-scope choice as a switch', async () => {
    actions.list.mockResolvedValue({ defaults: [], engagement: [] })
    render(<ActionsView />)
    fireEvent.click(await screen.findByRole('button', { name: /new action/i }))
    const panel = await screen.findByRole('complementary', { name: /new action/i })
    const scoped = within(panel).getByRole('switch', { name: /only targets in scope/i })
    expect(scoped.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(scoped)
    expect(scoped.getAttribute('aria-checked')).toBe('false')
    expect(within(panel).queryByRole('checkbox')).toBeNull()
  })
})
