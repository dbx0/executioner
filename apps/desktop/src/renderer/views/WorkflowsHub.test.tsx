import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { WorkflowSummary } from '../api/workflows.js'

const workflows: WorkflowSummary[] = [
  { id: 'wf-1', name: 'Recon sweep', updated_at: '2026-01-01T00:00:00.000Z' } as WorkflowSummary,
]

const fakeWorkflows = {
  list: vi.fn(() => Promise.resolve(workflows)),
  remove: vi.fn(() => Promise.resolve({ ok: true })),
  duplicate: vi.fn(() => Promise.resolve({ id: 'wf-2' })),
}
const fakeAgents = {
  list: vi.fn(() => Promise.resolve([])),
  remove: vi.fn(() => Promise.resolve({ ok: true })),
}

vi.mock('../api/workflows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/workflows.js')>()),
  workflowsApi: () => fakeWorkflows,
}))
vi.mock('../api/saved-agents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/saved-agents.js')>()),
  savedAgentsApi: () => fakeAgents,
}))

const { WorkflowsHub } = await import('./WorkflowsHub.js')

/** A promise the test resolves by hand, so the in-flight render can be asserted. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('WorkflowsHub loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A child builds a websocket url from the connection, so the store needs a
    // real-shaped one even though nothing in these tests talks to an engine.
    useApp.setState({
      // The recent-runs panel talks to the engine through the raw client, so it
      // needs the axios surface rather than an empty object.
      client: {
        get: () => Promise.resolve({ data: [] }),
        post: () => Promise.resolve({ data: {} }),
        patch: () => Promise.resolve({ data: {} }),
        delete: () => Promise.resolve({ data: {} }),
      } as unknown as AxiosInstance,
      hubTab: 'workflows',
      connection: { port: 4599, token: 't'.repeat(40), projectRoot: '/tmp/acme' },
    })
  })

  it('shows placeholder cards while the first load is in flight', async () => {
    const d = deferred<WorkflowSummary[]>()
    fakeWorkflows.list.mockReturnValueOnce(d.promise)

    render(<WorkflowsHub onCreate={() => {}} onOpen={() => {}} />)

    expect(screen.getByRole('status', { name: /loading workflows/i })).toBeTruthy()

    d.resolve(workflows)
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading workflows/i })).toBeNull())
  })

  it('drops the placeholders once the workflows are on screen', async () => {
    fakeWorkflows.list.mockReturnValueOnce(Promise.resolve(workflows))

    render(<WorkflowsHub onCreate={() => {}} onOpen={() => {}} />)

    expect(await screen.findByText('Recon sweep')).toBeTruthy()
    expect(screen.queryByRole('status', { name: /loading workflows/i })).toBeNull()
  })
})
