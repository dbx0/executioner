import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { Finding } from '../api/findings.js'

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  title: 'AWS key in bundle.js',
  severity: 'high',
  status: 'open',
  description: 'A live key ships to the browser.',
  details: 'AKIAEXAMPLE',
  targetId: 't1',
  source: 'workflow',
  executionId: 'exec-1',
  nodeId: 'save',
  evidencePath: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...over,
})

let rows: Finding[]

const fakeApi = {
  list: vi.fn(() => Promise.resolve(rows)),
  get: vi.fn(() => Promise.resolve(rows[0]!)),
  create: vi.fn(() => Promise.resolve(finding({ id: 'f-new', title: 'New finding' }))),
  update: vi.fn((id: string, patch: Record<string, unknown>) => Promise.resolve({ ...rows[0]!, ...patch, id })),
  remove: vi.fn(() => Promise.resolve({ ok: true })),
  report: vi.fn(() => Promise.resolve({ path: '/tmp/acme/reports/findings-2026-09-10-1200.md', relativePath: 'reports/findings-2026-09-10-1200.md', count: 2 })),
}

vi.mock('../api/findings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/findings.js')>()),
  findingsApi: () => fakeApi,
}))
vi.mock('../api/targets.js', () => ({
  targetsApi: () => ({ list: () => Promise.resolve([{ id: 't1', value: 'example.com' }]) }),
}))

const { FindingsView } = await import('./FindingsView.js')

describe('FindingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows = [finding(), finding({ id: 'f2', title: 'Directory listing', severity: 'low', description: '' })]
    useApp.setState({ client: {} as AxiosInstance })
  })

  it('lists findings with their severity and the asset they belong to', async () => {
    render(<FindingsView />)

    expect(await screen.findByText('AWS key in bundle.js')).toBeTruthy()
    expect(screen.getByText('Directory listing')).toBeTruthy()
    expect(screen.getAllByText('example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('high')).toBeTruthy()
  })

  it('opens a finding when its title is clicked, showing description and details', async () => {
    render(<FindingsView />)
    fireEvent.click(await screen.findByText('AWS key in bundle.js'))

    // Findings are filed as markdown, so reading one shows it rendered — the
    // description twice over, since the list row keeps its own snippet.
    expect(await screen.findAllByText('A live key ships to the browser.')).toHaveLength(2)
    expect(screen.getByText('AKIAEXAMPLE')).toBeTruthy()
    expect(screen.queryByDisplayValue('AKIAEXAMPLE')).toBeNull()
    // Where it came from is part of reading it.
    expect(screen.getByText(/workflow node save/)).toBeTruthy()
  })

  it('gives the open finding the whole page, and puts the list back', async () => {
    render(<FindingsView />)
    fireEvent.click(await screen.findByText('AWS key in bundle.js'))

    fireEvent.click(screen.getByRole('button', { name: 'Expand finding' }))
    // The other finding only exists in the list column, so its absence is the
    // column's absence.
    expect(screen.queryByText('Directory listing')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse finding' }))
    expect(screen.getByText('Directory listing')).toBeTruthy()
  })

  it('switches the prose fields to their markdown source for editing', async () => {
    render(<FindingsView />)
    fireEvent.click(await screen.findByText('AWS key in bundle.js'))

    fireEvent.click(screen.getByRole('button', { name: 'Edit description and details' }))

    expect(screen.getByDisplayValue('A live key ships to the browser.')).toBeTruthy()
    expect(screen.getByDisplayValue('AKIAEXAMPLE')).toBeTruthy()
  })

  it('saves an edit only once there is something to save', async () => {
    render(<FindingsView />)
    fireEvent.click(await screen.findByText('AWS key in bundle.js'))

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByDisplayValue('AWS key in bundle.js'), { target: { value: 'AWS key, confirmed live' } })
    expect(save.disabled).toBe(false)

    fireEvent.click(save)
    await waitFor(() =>
      expect(fakeApi.update).toHaveBeenCalledWith('f1', expect.objectContaining({ title: 'AWS key, confirmed live' })),
    )
  })

  it('asks before deleting, then deletes', async () => {
    render(<FindingsView />)
    fireEvent.click(await screen.findByText('AWS key in bundle.js'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete finding' }))

    expect(await screen.findByText(/cannot be undone/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(fakeApi.remove).toHaveBeenCalledWith('f1'))
  })

  it('filters the list by status', async () => {
    render(<FindingsView />)
    await screen.findByText('AWS key in bundle.js')

    expect(fakeApi.list).toHaveBeenCalledWith({})
  })

  it('creates a finding and opens it', async () => {
    render(<FindingsView />)
    await screen.findByText('AWS key in bundle.js')

    rows = [finding({ id: 'f-new', title: 'New finding', severity: 'medium', description: '' })]
    fireEvent.click(screen.getByRole('button', { name: /new finding/i }))

    await waitFor(() => expect(fakeApi.create).toHaveBeenCalledWith({ title: 'New finding', severity: 'medium' }))
    expect(await screen.findByDisplayValue('New finding')).toBeTruthy()
  })

  it('exports a report and says where it landed', async () => {
    render(<FindingsView />)
    await screen.findByText('AWS key in bundle.js')

    fireEvent.click(screen.getByRole('button', { name: /export report/i }))

    await waitFor(() => expect(fakeApi.report).toHaveBeenCalledWith({}))
    expect(await screen.findByText('reports/findings-2026-09-10-1200.md')).toBeTruthy()
  })

  it('opens the finding a target panel deep-linked to', async () => {
    useApp.setState({ pendingFindingId: 'f2' })
    render(<FindingsView />)

    expect(await screen.findByDisplayValue('Directory listing')).toBeTruthy()
    // Consumed once, so returning to the page later does not re-select it.
    expect(useApp.getState().pendingFindingId).toBeNull()
  })
})

describe('FindingsView loading state', () => {
  /** A promise the test resolves by hand, so the in-flight render can be asserted. */
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
    const d = deferred<Finding[]>()
    fakeApi.list.mockReturnValueOnce(d.promise)

    render(<FindingsView />)

    expect(screen.getByRole('status', { name: /loading findings/i })).toBeTruthy()

    d.resolve([finding()])
    expect(await screen.findByText('AWS key in bundle.js')).toBeTruthy()
    expect(screen.queryByRole('status', { name: /loading findings/i })).toBeNull()
  })

  it('does not claim the list is empty until the first load has finished', async () => {
    // The empty state used to render during the load, so every tab switch said
    // "nothing recorded yet" over a list that was about to arrive.
    const d = deferred<Finding[]>()
    fakeApi.list.mockReturnValueOnce(d.promise)

    render(<FindingsView />)

    expect(screen.queryByText(/nothing recorded yet/i)).toBeNull()

    d.resolve([])
    await waitFor(() => expect(screen.getByText(/nothing recorded yet/i)).toBeTruthy())
  })

  it('keeps the rows on screen while a refresh is in flight', async () => {
    // A refresh must not blank out data the user is already reading.
    fakeApi.list.mockReturnValueOnce(Promise.resolve([finding()]))
    render(<FindingsView />)
    expect(await screen.findByText('AWS key in bundle.js')).toBeTruthy()

    const d = deferred<Finding[]>()
    fakeApi.list.mockReturnValueOnce(d.promise)
    fireEvent.click(screen.getByLabelText('Refresh findings'))

    expect(screen.getByText('AWS key in bundle.js')).toBeTruthy()
    expect(screen.queryByRole('status', { name: /loading findings/i })).toBeNull()
    d.resolve([finding()])
  })
})
