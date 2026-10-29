import type { JSX } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../store.js'
import type { AxiosInstance } from 'axios'
import type { ScreenshotItem, TargetDetail, TargetNode } from '../api/targets.js'
import { emitChange } from '../lib/engine-changes.js'

const tree: TargetNode[] = [
  {
    id: 't1',
    kind: 'domain',
    value: 'example.com',
    apex: 'example.com',
    parentId: null,
    source: 'manual',
    scopeStatus: 'in',
    scopeReason: 'in scope by example.com',
    children: [
      {
        id: 't2',
        kind: 'subdomain',
        value: 'api.example.com',
        apex: 'example.com',
        parentId: 't1',
        source: 'subfinder',
        scopeStatus: 'in',
        scopeReason: 'in scope by example.com',
        children: [],
      },
    ],
  },
]

const detail: TargetDetail = {
  id: 't2',
  kind: 'subdomain',
  value: 'api.example.com',
  apex: 'example.com',
  parentId: 't1',
  source: 'subfinder',
  scopeStatus: 'in',
  scopeReason: 'in scope by example.com',
  firstSeen: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-01-02T00:00:00.000Z',
  facts: [],
  findings: [],
}

const fakeApi = {
  tree: vi.fn(() => Promise.resolve(tree)),
  list: vi.fn(() => Promise.resolve([])),
  get: vi.fn((id: string) => Promise.resolve({ ...detail, id })),
  screenshots: vi.fn(() => Promise.resolve([] as ScreenshotItem[])),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  scopeRules: vi.fn(() => Promise.resolve([])),
  addScopeRule: vi.fn(() => Promise.resolve({ rejudged: 0 })),
  updateScopeRule: vi.fn(),
  removeScopeRule: vi.fn(() => Promise.resolve({ ok: true, rejudged: 0 })),
}

const fakeRunWorkflow = vi.fn((_workflowId: string, _body: Record<string, unknown>) => Promise.resolve({}))

vi.mock('../api/targets.js', () => ({
  targetsApi: () => fakeApi,
}))
vi.mock('../api/workflows.js', () => ({
  workflowsApi: () => ({
    list: vi.fn(() =>
      Promise.resolve([{ id: 'wf1', name: 'Subdomain sweep', updated_at: '2026-09-01T00:00:00.000Z' }]),
    ),
  }),
}))
vi.mock('../api/executions.js', () => ({
  executionsApi: () => ({ runWorkflow: fakeRunWorkflow }),
}))
const fakeBackendList = vi.fn(() => Promise.resolve([] as { id: string; name: string }[]))
vi.mock('../api/backends.js', () => ({
  backendsApi: () => ({ list: fakeBackendList }),
}))

// The detail panel and virtual tree pull in heavier UI; keep the test focused on
// the deep-link wiring by stubbing them to reflect only what this view drives.
vi.mock('../components/targets/VirtualTargetTree.js', () => ({
  VirtualTargetTree: ({
    selectedId,
    nodes,
    onSelect,
    renderRow,
  }: {
    selectedId: string | null
    nodes: TargetNode[]
    onSelect: (n: TargetNode) => void
    renderRow?: (n: TargetNode, row: JSX.Element) => JSX.Element
  }) => (
    <div
      data-testid="tree"
      data-selected={selectedId ?? ''}
      data-values={nodes.flatMap((n) => [n.value, ...n.children.map((c) => c.value)]).join(',')}
    >
      <button type="button" onClick={() => onSelect(nodes[0] as TargetNode)}>
        pick first
      </button>
      {nodes[0] !== undefined && renderRow !== undefined
        ? renderRow(nodes[0], <div data-testid="row">{nodes[0].value}</div>)
        : null}
    </div>
  ),
}))

// Radix's context menu costs about twenty seconds per open under jsdom, and
// what these tests are checking is the view's wiring, not the menu's chrome.
// The real menu's own decisions are covered by lib/target-actions.test.ts.
vi.mock('../components/targets/TargetContextMenu.js', () => ({
  TargetContextMenu: ({
    workflows,
    backends,
    onAddToScope,
    onRemoveFromScope,
    onRunWorkflow,
    onRunTool,
    onDelete,
    children,
  }: {
    workflows: { id: string; name: string }[]
    backends: { id: string; name: string }[]
    onAddToScope: (p: string) => void
    onRemoveFromScope: (p: string) => void
    onRunWorkflow: (workflowId: string, backendId: string) => void
    onRunTool: () => void
    onDelete: () => void
    children: React.ReactNode
  }) => (
    <div data-testid="row-menu" data-backends={backends.map((b) => b.id).join(',')}>
      {children}
      {/* Sentinels, not real patterns: deriving the pattern is the menu's job
          and is covered by lib/target-actions.test.ts. What the view owes is to
          forward whatever it is handed, unchanged. */}
      <button type="button" onClick={() => onAddToScope('pattern-to-include')}>
        menu: add to scope
      </button>
      <button type="button" onClick={() => onRemoveFromScope('pattern-to-exclude')}>
        menu: remove from scope
      </button>
      <button
        type="button"
        onClick={() => onRunWorkflow(workflows[0]?.id ?? 'none', backends[backends.length - 1]?.id ?? 'local')}
      >
        menu: run last backend
      </button>
      <button type="button" onClick={onRunTool}>
        menu: run tool
      </button>
      <button type="button" onClick={onDelete}>
        menu: delete
      </button>
    </div>
  ),
}))

vi.mock('../components/targets/TargetDetail.js', () => ({
  TargetDetailPanel: ({ targetId, onClose }: { targetId: string; onClose?: () => void }) => (
    <div data-testid="detail">
      {targetId}
      <button type="button" aria-label="close detail" onClick={onClose} />
    </div>
  ),
}))

const { TargetsView } = await import('./TargetsView.js')

describe('TargetsView — command-palette deep link', () => {
  beforeEach(() => {
    useApp.setState({ client: {} as AxiosInstance, pendingTargetId: null })
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('selects the pending target and clears the pending id once revealed', async () => {
    useApp.setState({ pendingTargetId: 't2' })
    render(<TargetsView />)

    await waitFor(() => expect(screen.getByTestId('detail').textContent).toBe('t2'))
    expect(screen.getByTestId('tree').getAttribute('data-selected')).toBe('t2')
    expect(useApp.getState().pendingTargetId).toBeNull()
  })

  it('clears a pending id that does not exist in the tree', async () => {
    useApp.setState({ pendingTargetId: 'missing' })
    render(<TargetsView />)

    await waitFor(() => expect(useApp.getState().pendingTargetId).toBeNull())
    expect(screen.queryByTestId('detail')).toBeNull()
  })
})

describe('TargetsView — detail pane visibility', () => {
  beforeEach(() => {
    useApp.setState({ client: {} as AxiosInstance, pendingTargetId: null })
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('starts closed and opens when a row is picked', async () => {
    render(<TargetsView />)

    await waitFor(() => expect(screen.getByTestId('tree')).toBeTruthy())
    expect(screen.queryByTestId('detail')).toBeNull()

    fireEvent.click(screen.getByText('pick first'))
    expect(screen.getByTestId('detail').textContent).toBe('t1')
  })

  it('closes again from the panel and clears the selection', async () => {
    render(<TargetsView />)

    await waitFor(() => expect(screen.getByTestId('tree')).toBeTruthy())
    fireEvent.click(screen.getByText('pick first'))
    fireEvent.click(screen.getByLabelText('close detail'))

    expect(screen.queryByTestId('detail')).toBeNull()
    expect(screen.getByTestId('tree').getAttribute('data-selected')).toBe('')
  })
})

describe('TargetsView loading state', () => {
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
    const d = deferred<TargetNode[]>()
    fakeApi.tree.mockReturnValueOnce(d.promise)

    render(<TargetsView />)

    expect(screen.getByRole('status', { name: /loading targets/i })).toBeTruthy()

    d.resolve(tree)
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading targets/i })).toBeNull())
  })

  it('does not claim there are no targets until the first load has finished', async () => {
    const d = deferred<TargetNode[]>()
    fakeApi.tree.mockReturnValueOnce(d.promise)

    render(<TargetsView />)

    expect(screen.queryByText(/no targets yet/i)).toBeNull()

    d.resolve([])
    await waitFor(() => expect(screen.getByText(/no targets yet/i)).toBeTruthy())
  })
})

describe('TargetsView — scope filter', () => {
  const mixed: TargetNode[] = [
    {
      id: 't1',
      kind: 'domain',
      value: 'example.com',
      apex: 'example.com',
      parentId: null,
      source: 'manual',
      scopeStatus: 'in',
      scopeReason: 'in scope by example.com',
      children: [],
    },
    {
      id: 't3',
      kind: 'url',
      value: 'https://third-party.amazonaws.com/graphql',
      apex: 'amazonaws.com',
      parentId: null,
      source: 'agent',
      scopeStatus: 'unknown',
      scopeReason: 'no scope rule matches third-party.amazonaws.com',
      children: [],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({ client: {} as AxiosInstance, pendingTargetId: null })
    fakeApi.tree.mockResolvedValue(mixed)
  })

  it('shows every asset until a verdict is chosen', async () => {
    render(<TargetsView />)
    await waitFor(() =>
      expect(screen.getByTestId('tree').getAttribute('data-values')).toBe(
        'example.com,https://third-party.amazonaws.com/graphql',
      ),
    )
  })

  it('narrows the tree to the assets that still need a decision', async () => {
    render(<TargetsView />)
    await screen.findByRole('tab', { name: /unscoped/i })

    fireEvent.click(screen.getByRole('tab', { name: /unscoped/i }))

    await waitFor(() =>
      expect(screen.getByTestId('tree').getAttribute('data-values')).toBe(
        'https://third-party.amazonaws.com/graphql',
      ),
    )
  })

  it('counts each verdict on its tab', async () => {
    render(<TargetsView />)
    const tab = await screen.findByRole('tab', { name: /unscoped/i })
    expect(tab.textContent).toContain('1')
  })

  it('offers no filter at all when every asset shares one verdict', async () => {
    fakeApi.tree.mockResolvedValue([mixed[0]!])
    render(<TargetsView />)
    await waitFor(() => expect(screen.getByTestId('tree')).toBeTruthy())
    expect(screen.queryByRole('tablist', { name: /scope/i })).toBeNull()
  })
})

describe('TargetsView — right-click actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({ client: {} as AxiosInstance, pendingTargetId: null })
    fakeApi.tree.mockResolvedValue(tree)
    fakeApi.addScopeRule.mockResolvedValue({ rejudged: 2 })
    fakeApi.removeScopeRule.mockResolvedValue({ ok: true, rejudged: 0 })
    fakeApi.remove.mockResolvedValue({ ok: true, removed: 2 })
    fakeBackendList.mockResolvedValue([])
  })

  const openMenu = async (): Promise<void> => {
    render(<TargetsView />)
    await screen.findByTestId('row-menu')
  }

  it('wraps each row in a menu for that target', async () => {
    await openMenu()
    expect(screen.getByTestId('row-menu')).toBeTruthy()
  })

  it('forwards the menu pattern as an include rule', async () => {
    await openMenu()
    fireEvent.click(screen.getByText('menu: add to scope'))

    await waitFor(() =>
      expect(fakeApi.addScopeRule).toHaveBeenCalledWith({ effect: 'include', pattern: 'pattern-to-include' }),
    )
  })

  it('forwards the menu pattern as an exclude rule', async () => {
    await openMenu()
    fireEvent.click(screen.getByText('menu: remove from scope'))

    await waitFor(() =>
      expect(fakeApi.addScopeRule).toHaveBeenCalledWith({ effect: 'exclude', pattern: 'pattern-to-exclude' }),
    )
  })

  it('refreshes the tree after a scope change so the badges move', async () => {
    await openMenu()
    fakeApi.tree.mockClear()
    fireEvent.click(screen.getByText('menu: add to scope'))

    await waitFor(() => expect(fakeApi.tree).toHaveBeenCalled())
  })

  it('runs the picked workflow against that target', async () => {
    await openMenu()
    fireEvent.click(screen.getByText('menu: run last backend'))

    await waitFor(() =>
      expect(fakeRunWorkflow).toHaveBeenCalledWith('wf1', expect.objectContaining({ targetId: 't1' })),
    )
  })

  it('opens the Tools page with that target picked', async () => {
    useApp.setState({ activeView: 'targets', pendingToolTargetId: null })
    await openMenu()
    fireEvent.click(screen.getByText('menu: run tool'))

    expect(useApp.getState().activeView).toBe('tools')
    expect(useApp.getState().pendingToolTargetId).toBe('t1')
  })

  it('deletes a target once the subtree warning is acknowledged', async () => {
    await openMenu()
    fireEvent.click(screen.getByText('menu: delete'))

    await waitFor(() => expect(fakeApi.remove).toHaveBeenCalledWith('t1'))
  })
})

describe('TargetsView — where a run happens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useApp.setState({ client: {} as AxiosInstance, pendingTargetId: null })
    fakeApi.tree.mockResolvedValue(tree)
  })

  const openMenu = async (): Promise<void> => {
    render(<TargetsView />)
    await screen.findByTestId('row-menu')
  }

  it('runs here without asking when there is no connection configured', async () => {
    fakeBackendList.mockResolvedValue([])
    await openMenu()
    fireEvent.click(screen.getByText('menu: run last backend'))

    await waitFor(() => expect(fakeRunWorkflow).toHaveBeenCalled())
    // Running here is the absence of a profile id, not a profile called local.
    expect(fakeRunWorkflow.mock.calls[0]?.[1]).not.toHaveProperty('backendProfileId')
  })

  it('offers a configured connection and sends its id when picked', async () => {
    fakeBackendList.mockResolvedValue([{ id: 'b1', name: 'kali-vps' }])
    await openMenu()
    fireEvent.click(screen.getByText('menu: run last backend'))

    await waitFor(() =>
      expect(fakeRunWorkflow).toHaveBeenCalledWith(
        'wf1',
        expect.objectContaining({ targetId: 't1', backendProfileId: 'b1' }),
      ),
    )
  })

  it('says which machine it sent the run to', async () => {
    fakeBackendList.mockResolvedValue([{ id: 'b1', name: 'kali-vps' }])
    await openMenu()
    fireEvent.click(screen.getByText('menu: run last backend'))

    expect(await screen.findByText(/running .* on kali-vps/i)).toBeTruthy()
  })

  it('refetches the tree on a targets change', async () => {
    render(<TargetsView />)
    await waitFor(() => expect(fakeApi.tree).toHaveBeenCalledTimes(1))

    emitChange('targets')

    await waitFor(() => expect(fakeApi.tree).toHaveBeenCalledTimes(2))
  })
})
