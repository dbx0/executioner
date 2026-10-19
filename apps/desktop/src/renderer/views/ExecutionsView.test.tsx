import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { ExecutionSummary } from '../api/executions.js'

// Newest first, as the engine returns them. The finished run leads so the
// view's "select the first run" behaviour is not what a stop click would do.
const runs: ExecutionSummary[] = [
  {
    id: 'exec-done',
    workflowId: 'wf-1',
    targetId: null,
    status: 'succeeded',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
  },
  {
    id: 'exec-running',
    workflowId: 'wf-1',
    targetId: null,
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
  },
]

const fakeApi = {
  list: vi.fn(() => Promise.resolve(runs)),
  get: vi.fn(() => Promise.resolve({})),
  output: vi.fn(() => Promise.resolve([])),
  runWorkflow: vi.fn(),
  step: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(() => Promise.resolve({ ok: true, status: 'cancelled' })),
}

vi.mock('../api/executions.js', () => ({ executionsApi: () => fakeApi }))
vi.mock('../api/workflows.js', () => ({
  workflowsApi: () => ({ list: () => Promise.resolve([{ id: 'wf-1', name: 'Recon sweep', updated_at: '' }]) }),
}))
vi.mock('../api/targets.js', () => ({ targetsApi: () => ({ list: () => Promise.resolve([]) }) }))
vi.mock('../lib/events.js', () => ({ useEngineEvents: () => [] }))

const { ExecutionsView } = await import('./ExecutionsView.js')

describe('ExecutionsView — stopping a run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({
      client: {} as AxiosInstance,
      connection: { port: 1, token: 't', projectRoot: '/tmp/acme' },
      pendingExecutionId: null,
    })
  })

  it('offers a stop control only for the run that is still going', async () => {
    render(<ExecutionsView />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /stop run/i })).toHaveLength(1))
  })

  it('stops that run and refreshes the list', async () => {
    render(<ExecutionsView />)
    const stop = await screen.findByRole('button', { name: /stop run/i })

    fireEvent.click(stop)

    expect(fakeApi.cancel).toHaveBeenCalledWith('exec-running')
    // The row's new state comes from the engine, so the list is re-read.
    await waitFor(() => expect(fakeApi.list.mock.calls.length).toBeGreaterThan(1))
  })

  it('does not select the run just because its stop button was clicked', async () => {
    render(<ExecutionsView />)
    const stop = await screen.findByRole('button', { name: /stop run/i })

    fireEvent.click(stop)

    // Selecting is what the row does; the stop button must not do it too — the
    // selection stays on the run that was already open.
    await waitFor(() => expect(fakeApi.output).toHaveBeenCalledWith('exec-done'))
    expect(fakeApi.output).not.toHaveBeenCalledWith('exec-running')
  })
})

describe('ExecutionsView loading state', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({ client: {} as AxiosInstance })
  })

  it('shows placeholder rows while the first load is in flight', async () => {
    const d = deferred<ExecutionSummary[]>()
    fakeApi.list.mockReturnValueOnce(d.promise)

    render(<ExecutionsView />)

    expect(screen.getByRole('status', { name: /loading runs/i })).toBeTruthy()

    d.resolve(runs)
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading runs/i })).toBeNull())
  })

  it('does not claim there are no runs until the first load has finished', async () => {
    const d = deferred<ExecutionSummary[]>()
    fakeApi.list.mockReturnValueOnce(d.promise)

    render(<ExecutionsView />)

    expect(screen.queryByText(/no runs yet/i)).toBeNull()

    d.resolve([])
    await waitFor(() => expect(screen.getByText(/no runs yet/i)).toBeTruthy())
  })
})
