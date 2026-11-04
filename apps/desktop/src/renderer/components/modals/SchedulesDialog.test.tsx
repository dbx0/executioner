import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import type { Schedule } from '../../api/schedules.js'

const list = vi.fn<() => Promise<Schedule[]>>(() => Promise.resolve([]))
const create = vi.fn(() => Promise.resolve({} as Schedule))
vi.mock('../../api/schedules.js', () => ({
  schedulesApi: () => ({ list, create, setEnabled: vi.fn(), remove: vi.fn() }),
}))
vi.mock('../../api/workflows.js', () => ({
  workflowsApi: () => ({ list: () => Promise.resolve([{ id: 'wf-1', name: 'Recon' }]), get: vi.fn() }),
}))
vi.mock('../../api/targets.js', () => ({ targetsApi: () => ({ list: () => Promise.resolve([]) }) }))
vi.mock('../../api/backends.js', () => ({
  backendsApi: () => ({
    list: () =>
      Promise.resolve([{ id: 'kali-1', name: 'kali box', kind: 'ssh', createdAt: '', updatedAt: '' }]),
  }),
}))

const { SchedulesDialog, scheduleInputFrom } = await import('./SchedulesDialog.js')

function baseForm() {
  return {
    workflowId: 'wf-1',
    kind: 'interval' as const,
    intervalSeconds: '3600',
    targetId: '',
    targetKind: 'domain',
    backendProfileId: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue([])
})

describe('scheduleInputFrom', () => {
  it('carries a chosen backend profile id onto an interval schedule', () => {
    expect(scheduleInputFrom({ ...baseForm(), backendProfileId: 'kali-1' })).toEqual({
      workflowId: 'wf-1',
      kind: 'interval',
      intervalSeconds: 3600,
      backendProfileId: 'kali-1',
    })
  })

  it('omits the backend when following the engagement default', () => {
    expect('backendProfileId' in scheduleInputFrom(baseForm())).toBe(false)
    expect('backendProfileId' in scheduleInputFrom({ ...baseForm(), backendProfileId: 'default' })).toBe(false)
  })

  it('sends local explicitly, so a schedule can stay on this machine under a remote default', () => {
    expect(scheduleInputFrom({ ...baseForm(), backendProfileId: 'local' }).backendProfileId).toBe('local')
  })

  it('carries the backend onto an on_create schedule too', () => {
    expect(
      scheduleInputFrom({ ...baseForm(), kind: 'on_create', backendProfileId: 'kali-1' }),
    ).toEqual({ workflowId: 'wf-1', kind: 'on_create', targetKind: 'domain', backendProfileId: 'kali-1' })
  })
})

describe('SchedulesDialog backend picker', () => {
  it('offers a backend selector that defaults to the engagement default', async () => {
    render(<SchedulesDialog client={{} as AxiosInstance} onClose={() => {}} />)
    const picker = await screen.findByLabelText('Backend')
    expect(picker.getAttribute('role')).toBe('combobox')
    expect(picker.textContent).toMatch(/engagement default/i)
  })

  it('shows a schedule pinned to local as running on this machine', async () => {
    list.mockResolvedValue([
      {
        id: 's1',
        workflowId: 'wf-1',
        targetId: null,
        kind: 'interval',
        intervalSeconds: 3600,
        targetKind: null,
        backendProfileId: 'local',
        enabled: true,
        createdAt: '',
      },
    ])
    render(<SchedulesDialog client={{} as AxiosInstance} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/on this machine/)).toBeTruthy())
  })

  it('shows the backend on a scheduled row that pins one', async () => {
    list.mockResolvedValue([
      {
        id: 's1',
        workflowId: 'wf-1',
        targetId: null,
        kind: 'interval',
        intervalSeconds: 3600,
        targetKind: null,
        backendProfileId: 'kali-1',
        enabled: true,
        createdAt: '',
      },
    ])
    render(<SchedulesDialog client={{} as AxiosInstance} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/kali box/)).toBeTruthy())
  })
})
