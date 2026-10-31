import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../store.js'
import type { OpenEngagement } from '../store/types.js'

const mounts = vi.hoisted(() => ({ count: {} as Record<string, number> }))

vi.mock('../components/terminal/Terminal.js', () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => {
    useEffect(() => {
      mounts.count[sessionId] = (mounts.count[sessionId] ?? 0) + 1
    }, [sessionId])
    return (
      <div data-testid={`terminal-${sessionId}`}>
        <textarea aria-label={`input-${sessionId}`} />
      </div>
    )
  },
}))
vi.mock('../components/workspace/FileViewer.js', () => ({
  FileViewer: ({ file }: { file: { id: string } }) => <div data-testid={`file-${file.id}`} />,
  isMarkdownPath: () => false,
}))
vi.mock('../components/SpawnMenu.js', () => ({
  SpawnMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ALL_AGENT_ROWS: [{ id: 'claude', label: 'Claude', Icon: () => <span /> }],
}))
vi.mock('../lib/monaco-setup.js', () => ({
  monaco: { editor: { getModel: () => null }, Uri: { parse: (v: string) => v } },
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
)
Element.prototype.scrollIntoView = () => {}

const { TerminalsView } = await import('./TerminalsView.js')

const state = () => useApp.getState()

function seed(): void {
  mounts.count = {}
  const engagement = {
    root: '/r',
    name: 'r',
    connection: { port: 1, token: 't', projectRoot: '/r' },
    client: {},
    sessions: [
      { id: 't1', label: 'Shell 1', agent: 'shell' },
      { id: 't2', label: 'Shell 2', agent: 'shell' },
    ],
    activeSessionId: 't1',
    sessionState: {},
    subagents: {},
    files: [],
    browsers: [],
    browserActivity: {},
    browserAsks: {},
    activeTab: { kind: 'terminal', id: 't1' },
    tabMeta: {},
    editorDrafts: {},
    diskBaselines: {},
    externalMutation: {},
    layouts: [
      { id: 'terminal:t1', root: { type: 'leaf', id: 'p1', item: { kind: 'terminal', id: 't1' } }, focusedLeafId: 'p1' },
      { id: 'terminal:t2', root: { type: 'leaf', id: 'p2', item: { kind: 'terminal', id: 't2' } }, focusedLeafId: 'p2' },
    ],
    activeLayoutId: 'terminal:t1',
  } as unknown as OpenEngagement
  useApp.setState({
    open: [engagement],
    activeRoot: '/r',
    connection: engagement.connection,
    client: engagement.client,
    sessions: engagement.sessions,
    activeSessionId: 't1',
    sessionState: {},
    subagents: {},
    files: [],
    activeTab: { kind: 'terminal', id: 't1' },
    tabMeta: {},
    layouts: engagement.layouts,
    activeLayoutId: 'terminal:t1',
  })
}

const body = (id: string): HTMLElement => screen.getByTestId(`terminal-${id}`).parentElement!.parentElement!

describe('TerminalsView panes', () => {
  beforeEach(seed)

  it('a single pane layout renders one full-size body with no divider', () => {
    render(<TerminalsView />)
    expect(body('t1').style.width).toBe('100%')
    expect(body('t1').style.height).toBe('100%')
    expect(body('t1').style.left).toBe('0%')
    expect(body('t1').style.top).toBe('0%')
    expect(body('t1').style.padding).toBe('')
    expect(body('t2').className).toContain('hidden')
    expect(screen.queryAllByRole('separator')).toHaveLength(0)
  })

  it('splitting renders two bodies side by side and one divider', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const split = state().layouts[0]!.root
    const newId = split.type === 'split' && split.b.type === 'leaf' ? split.b.id : ''
    act(() => state().fillPane(newId, { kind: 'terminal', id: 't2' }))
    // Outer edges bleed fully; the shared edge is inset by 0.5px on each side (a 1px seam).
    expect(body('t1').style.left).toBe('0%')
    expect(body('t1').style.width).toBe('calc(50% - 0.5px)')
    expect(body('t2').style.left).toBe('calc(50% + 0.5px)')
    expect(body('t2').style.width).toBe('calc(50% - 0.5px)')
    expect(body('t1').style.top).toBe('0%')
    expect(body('t1').style.height).toBe('100%')
    expect(body('t1').style.padding).toBe('')
    expect(body('t2').style.padding).toBe('')
    expect(body('t2').className).not.toContain('hidden')
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('splitting and moving a terminal never remounts it', () => {
    render(<TerminalsView />)
    expect(mounts.count['t1']).toBe(1)
    act(() => state().splitPane('p1', 'row'))
    const split = state().layouts[0]!.root
    const newId = split.type === 'split' && split.b.type === 'leaf' ? split.b.id : ''
    act(() => state().fillPane(newId, { kind: 'terminal', id: 't2' }))
    act(() => state().movePaneToNewTab(newId))
    act(() => state().setActiveTab({ kind: 'terminal', id: 't1' }))
    expect(mounts.count['t1']).toBe(1)
    expect(mounts.count['t2']).toBe(1)
  })

  it('clicking a pane focuses it', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const split = state().layouts[0]!.root
    const newId = split.type === 'split' && split.b.type === 'leaf' ? split.b.id : ''
    act(() => state().fillPane(newId, { kind: 'terminal', id: 't2' }))
    expect(state().layouts[0]!.focusedLeafId).toBe(newId)
    fireEvent.mouseDown(screen.getByTestId('terminal-t1'))
    expect(state().layouts[0]!.focusedLeafId).toBe('p1')
  })

  it('the strip shows one tab per layout with the split icon on split layouts', () => {
    const { container } = render(<TerminalsView />)
    // The new pane's picker also lists the other tab, so count the strip only.
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    expect(within(strip).getAllByText(/^Shell \d$/)).toHaveLength(2)
    expect(container.querySelector('[aria-label="Split tab"]')).toBeNull()
    act(() => state().splitPane('p1', 'row'))
    expect(within(strip).getAllByText(/^Shell \d$/)).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="Split tab"]')).toHaveLength(1)
  })

  it('a split draws a 1px line in the border colour on the seam', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const line = screen.getByRole('separator').querySelector('[data-testid="divider-line"]')
    expect(line).not.toBeNull()
    expect(line!.className).toContain('w-px')
    expect(line!.className).toContain('bg-border')
  })

  it('a file wrapper in a split gets no extra padding', () => {
    const file = { id: 'f1', path: '/r/a.txt', name: 'a.txt' }
    useApp.setState({ files: [file], open: [{ ...state().open[0]!, files: [file] }] })
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const split = state().layouts[0]!.root
    const newId = split.type === 'split' && split.b.type === 'leaf' ? split.b.id : ''
    act(() => state().fillPane(newId, { kind: 'file', id: 'f1' }))
    const wrapper = screen.getByTestId('file-f1').parentElement!
    expect(wrapper.style.padding).toBe('')
    expect(wrapper.className).not.toMatch(/\bp-/)
    expect(wrapper.style.left).toBe('calc(50% + 0.5px)')
    expect(wrapper.style.width).toBe('calc(50% - 0.5px)')
  })

  it('an empty-only layout still has a tab, and it is the active one', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const split = state().layouts[0]!.root
    const newId = split.type === 'split' && split.b.type === 'leaf' ? split.b.id : ''
    act(() => state().movePaneToNewTab(newId))
    expect(state().layouts).toHaveLength(3)
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    const tab = within(strip).getByText('Empty pane').parentElement!
    expect(tab.className).toMatch(/(^|\s)text-foreground/)
    expect(within(strip).getAllByLabelText('Close tab')).toHaveLength(3)
    act(() => state().focusPane('terminal:t1', 'p1'))
    expect(within(strip).getByText('Empty pane').parentElement!.className).not.toMatch(/(^|\s)text-foreground/)
    fireEvent.click(within(strip).getByText('Empty pane'))
    expect(state().activeLayoutId).toBe(state().layouts[1]!.id)
    fireEvent.click(within(strip).getAllByLabelText('Close tab')[1]!)
    expect(state().layouts).toHaveLength(2)
  })
})

describe('TerminalsView split commands', () => {
  beforeEach(seed)

  const emptyPaneId = (): string => {
    const root = state().layouts[0]!.root
    return root.type === 'split' && root.b.type === 'leaf' ? root.b.id : ''
  }
  const openTabMenu = (title: string): void => {
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    fireEvent.contextMenu(within(strip).getByText(title))
  }

  it('tab menu Split right leaves a picker pane', () => {
    render(<TerminalsView />)
    openTabMenu('Shell 1')
    fireEvent.click(screen.getByText('Split right'))
    const root = state().layouts[0]!.root
    expect(root.type === 'split' && root.dir).toBe('row')
    expect(screen.getByTestId(`empty-pane-${emptyPaneId()}`)).toBeTruthy()
  })

  it('the picker lists other items and New rows, and picking an item fills the pane', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const slot = within(screen.getByTestId(`empty-pane-${emptyPaneId()}`))
    expect(slot.getByText('Shell 2')).toBeTruthy()
    expect(slot.queryByText('Shell 1')).toBeNull()
    expect(slot.getByText('Shell')).toBeTruthy()
    expect(slot.getByText('Claude')).toBeTruthy()
    fireEvent.click(slot.getByText('Shell 2'))
    expect(state().layouts).toHaveLength(1)
    expect(leavesOf(state().layouts[0]!.root)).toEqual(['terminal:t1', 'terminal:t2'])
  })

  it('the picker lists items of a multi-pane layout and picking one moves that pane', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p2', 'row', { kind: 'terminal', id: 't2' }))
    act(() => state().focusPane('terminal:t1', 'p1'))
    act(() => state().splitPane('p1', 'row'))
    const slot = within(screen.getByTestId(`empty-pane-${emptyPaneId()}`))
    fireEvent.click(slot.getByText('Shell 2'))
    expect(leavesOf(state().layouts[0]!.root)).toEqual(['terminal:t1', 'terminal:t2'])
  })

  it('the picker New Shell creates a session into the pane', () => {
    const createSession = vi.fn(() => Promise.resolve())
    useApp.setState({ createSession })
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const id = emptyPaneId()
    fireEvent.click(within(screen.getByTestId(`empty-pane-${id}`)).getByText('Shell'))
    expect(createSession).toHaveBeenCalledWith({ kind: 'shell' }, { into: id })
  })

  it('Move pane to new tab breaks the pane out', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row', { kind: 'terminal', id: 't2' }))
    expect(state().layouts).toHaveLength(1)
    // The new pane holds Shell 2 and has focus, so it stands for the tab.
    openTabMenu('Shell 2')
    fireEvent.click(screen.getByText('Move pane to new tab'))
    expect(state().layouts).toHaveLength(2)
    // Shell 2 left, Shell 1 stayed; the new layout sits right after the current one and is active.
    expect(leavesOf(state().layouts[0]!.root)).toEqual(['terminal:t1'])
    expect(leavesOf(state().layouts[1]!.root)).toEqual(['terminal:t2'])
    expect(state().activeLayoutId).toBe(state().layouts[1]!.id)
  })

  it('a tab menu split on a background layout selects that layout and splits it', () => {
    render(<TerminalsView />)
    expect(state().activeLayoutId).toBe('terminal:t1')
    openTabMenu('Shell 2')
    fireEvent.click(screen.getByText('Split right'))
    expect(state().activeLayoutId).toBe('terminal:t2')
    expect(state().layouts[0]!.root.type).toBe('leaf')
    const root = state().layouts[1]!.root
    expect(root.type === 'split' && root.dir).toBe('row')
    expect(root.type === 'split' && root.a.type === 'leaf' && root.a.id).toBe('p2')
  })

  it('the tab menu closes the pane on a split tab and offers closing them all', () => {
    render(<TerminalsView />)
    const menu = (): HTMLElement => document.querySelector('.z-\\[71\\]') as HTMLElement
    openTabMenu('Shell 1')
    expect(within(menu()).getByText('Close').parentElement!.textContent).toMatch(/W$/)
    expect(within(menu()).queryByText('Close all panes')).toBeNull()
    fireEvent.click(document.body)
    act(() => state().splitPane('p1', 'row'))
    openTabMenu('Shell 1')
    expect(within(menu()).getByText('Close pane').parentElement!.textContent).toMatch(/W$/)
    expect(within(menu()).getByText('Close all panes')).toBeTruthy()
  })

  it('Move pane to new tab is only offered once the layout is split', () => {
    render(<TerminalsView />)
    openTabMenu('Shell 1')
    expect(screen.queryByText('Move pane to new tab')).toBeNull()
  })

  it('the pane menu on an empty pane splits it and closes it', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const id = emptyPaneId()
    fireEvent.contextMenu(screen.getByTestId(`empty-pane-${id}`))
    fireEvent.click(screen.getByText('Split down'))
    expect(state().layouts[0]!.root.type).toBe('split')
    expect(document.querySelectorAll('[data-testid^="empty-pane-"]')).toHaveLength(2)
    fireEvent.contextMenu(screen.getByTestId(`empty-pane-${id}`))
    fireEvent.click(screen.getByText('Close pane'))
    expect(document.querySelectorAll('[data-testid^="empty-pane-"]')).toHaveLength(1)
  })
})

describe('TerminalsView keyboard focus', () => {
  beforeEach(() => {
    seed()
    ;(document.activeElement as HTMLElement | null)?.blur()
  })

  const input = (id: string): HTMLElement => screen.getByLabelText(`input-${id}`)
  const splitWithT2 = (): void => {
    act(() => state().splitPane('p1', 'row', { kind: 'terminal', id: 't2' }))
  }

  it('moving focus between panes moves keyboard focus into the target pane', () => {
    render(<TerminalsView />)
    splitWithT2()
    expect(document.activeElement).toBe(input('t2'))
    act(() => state().moveFocus('left'))
    expect(document.activeElement).toBe(input('t1'))
    act(() => state().moveFocus('right'))
    expect(document.activeElement).toBe(input('t2'))
  })

  it('filling a picker pane focuses the filled pane', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const id = state().layouts[0]!.focusedLeafId
    const slot = within(screen.getByTestId(`empty-pane-${id}`))
    expect(screen.getByTestId(`empty-pane-${id}`).contains(document.activeElement)).toBe(true)
    fireEvent.click(slot.getByText('Shell 2'))
    expect(document.activeElement).toBe(input('t2'))
  })

  it('moving focus to an empty pane focuses its picker', () => {
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const id = state().layouts[0]!.focusedLeafId
    act(() => state().moveFocus('left'))
    expect(document.activeElement).toBe(input('t1'))
    act(() => state().moveFocus('right'))
    expect(screen.getByTestId(`empty-pane-${id}`).contains(document.activeElement)).toBe(true)
  })

  it('does not steal focus from outside the workspace', () => {
    render(<TerminalsView />)
    splitWithT2()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    act(() => state().moveFocus('left'))
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

function leavesOf(root: import('../lib/pane-tree.js').PaneNode): string[] {
  return root.type === 'leaf'
    ? root.item === null
      ? []
      : [`${root.item.kind}:${root.item.id}`]
    : [...leavesOf(root.a), ...leavesOf(root.b)]
}

describe('TerminalsView tab drag and close', () => {
  const MIME = 'application/x-exe-item'
  beforeEach(seed)

  const dragData = (item: { kind: string; id: string }) => ({
    types: [MIME],
    getData: (type: string) => (type === MIME ? JSON.stringify(item) : ''),
    setData: vi.fn(),
    effectAllowed: 'move',
    dropEffect: 'move',
  })
  const startDrag = (item: { kind: string; id: string }): ReturnType<typeof dragData> => {
    const data = dragData(item)
    act(() => {
      fireEvent.dragEnter(document.body, { dataTransfer: data })
    })
    return data
  }

  it('dropping a tab on a pane\'s right edge splits and moves it in', () => {
    render(<TerminalsView />)
    const data = startDrag({ kind: 'terminal', id: 't2' })
    fireEvent.drop(screen.getByTestId('drop-right-p1'), { dataTransfer: data })
    expect(state().layouts).toHaveLength(1)
    expect(leavesOf(state().layouts[0]!.root)).toEqual(['terminal:t1', 'terminal:t2'])
    const root = state().layouts[0]!.root
    expect(root.type === 'split' && root.dir).toBe('row')
    expect(screen.queryByTestId('drop-right-p1')).toBeNull()
  })

  it('dropping on the left edge puts the item on the left', () => {
    render(<TerminalsView />)
    const data = startDrag({ kind: 'terminal', id: 't2' })
    fireEvent.drop(screen.getByTestId('drop-left-p1'), { dataTransfer: data })
    expect(leavesOf(state().layouts[0]!.root)).toEqual(['terminal:t2', 'terminal:t1'])
    fireEvent.dragEnter(document.body, { dataTransfer: data })
    fireEvent.drop(screen.getByTestId('drop-top-p1'), { dataTransfer: dragData({ kind: 'terminal', id: 't1' }) })
    const root = state().layouts[0]!.root
    expect(root.type === 'split' && root.dir).toBe('row')
  })

  it('dropping onto its own pane does nothing', () => {
    render(<TerminalsView />)
    const before = state().layouts
    const data = startDrag({ kind: 'terminal', id: 't1' })
    fireEvent.drop(screen.getByTestId('drop-right-p1'), { dataTransfer: data })
    expect(state().layouts).toBe(before)
  })

  it('a tab is draggable and carries its item', () => {
    render(<TerminalsView />)
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    const tab = within(strip).getByText('Shell 2').parentElement!
    expect(tab.getAttribute('draggable')).toBe('true')
    const data = dragData({ kind: 'terminal', id: 't2' })
    fireEvent.dragStart(tab, { dataTransfer: data })
    expect(data.setData).toHaveBeenCalledWith(MIME, JSON.stringify({ kind: 'terminal', id: 't2' }))
  })

  const splitWorking = (): void => {
    const sessions = [
      { id: 't1', label: 'Shell 1', agent: 'shell' },
      { id: 't2', label: 'Claude', agent: 'claude' },
      { id: 't3', label: 'Shell 3', agent: 'shell' },
    ]
    const third = { id: 'terminal:t3', root: { type: 'leaf' as const, id: 'p3', item: { kind: 'terminal', id: 't3' } }, focusedLeafId: 'p3' }
    const patch = { sessions, layouts: [...state().layouts, third], sessionState: { t2: 'working' as const } }
    act(() => {
      useApp.setState({ ...patch, open: [{ ...state().open[0]!, ...patch }] })
      state().splitPane('p1', 'row', { kind: 'terminal', id: 't2' })
    })
  }
  // The split tab shows its focused pane, the Claude session splitWorking just placed.
  const closeFirstTab = (): void => {
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    fireEvent.contextMenu(within(strip).getByText('Claude'))
    fireEvent.click(screen.getByText('Close all panes'))
  }

  it('closing a split layout with a working agent asks first', () => {
    render(<TerminalsView />)
    splitWorking()
    closeFirstTab()
    expect(screen.getByText('Close all 2 panes? An agent is still working.')).toBeTruthy()
    expect(state().layouts).toHaveLength(2)
    fireEvent.click(screen.getByText('Cancel'))
    expect(state().layouts).toHaveLength(2)
    closeFirstTab()
    fireEvent.click(screen.getByRole('button', { name: 'Close all' }))
    expect(state().layouts.map((l) => l.id)).toEqual(['terminal:t3'])
    expect(state().sessions.map((x) => x.id)).toEqual(['t3'])
  })

  it('bulk closing asks first when it would close a split with a working agent', () => {
    render(<TerminalsView />)
    splitWorking()
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    fireEvent.contextMenu(within(strip).getByText('Shell 3'))
    fireEvent.click(screen.getByText('Close Others'))
    expect(screen.getByText('Close 1 tab? An agent is still working in it.')).toBeTruthy()
    expect(state().layouts).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Close all' }))
    expect(state().layouts.map((l) => l.id)).toEqual(['terminal:t3'])
  })

  it('closing a single pane tab with a working agent does not ask', () => {
    render(<TerminalsView />)
    const patch = {
      sessions: [
        { id: 't1', label: 'Shell 1', agent: 'shell' },
        { id: 't2', label: 'Claude', agent: 'claude' },
      ],
      sessionState: { t2: 'working' as const },
    }
    act(() => useApp.setState({ ...patch, open: [{ ...state().open[0]!, ...patch }] }))
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    // A working agent alone in its tab closes straight away.
    fireEvent.click(within(strip).getAllByLabelText('Close tab')[1]!)
    expect(screen.queryByText(/Close all/)).toBeNull()
    expect(state().sessions.map((x) => x.id)).toEqual(['t1'])
  })

  it('the X on a split tab closes only the pane the tab shows', () => {
    render(<TerminalsView />)
    splitWorking()
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    fireEvent.click(within(strip).getAllByLabelText('Close tab')[0]!)
    expect(screen.queryByText(/Close all/)).toBeNull()
    expect(state().sessions.map((x) => x.id)).toEqual(['t1', 't3'])
    expect(state().layouts.map((l) => l.id)).toEqual(['terminal:t1', 'terminal:t3'])
    expect(state().layouts[0]!.root).toMatchObject({ type: 'leaf', item: { kind: 'terminal', id: 't1' } })
  })

  it('closing all panes of an idle split layout does not ask', () => {
    render(<TerminalsView />)
    const third = { id: 'terminal:t3', root: { type: 'leaf' as const, id: 'p3', item: { kind: 'terminal', id: 't3' } }, focusedLeafId: 'p3' }
    const patch = {
      sessions: [...state().sessions, { id: 't3', label: 'Shell 3', agent: 'shell' }],
      layouts: [...state().layouts, third],
    }
    act(() => {
      useApp.setState({ ...patch, open: [{ ...state().open[0]!, ...patch }] })
      state().splitPane('p1', 'row', { kind: 'terminal', id: 't2' })
    })
    const strip = document.querySelector('.scrollbar-none') as HTMLElement
    fireEvent.contextMenu(within(strip).getByText('Shell 2'))
    fireEvent.click(screen.getByText('Close all panes'))
    expect(screen.queryByText(/Close all \d/)).toBeNull()
    expect(state().layouts.map((l) => l.id)).toEqual(['terminal:t3'])
  })

  it('a right-click inside the close confirmation does not open the tab menu', () => {
    render(<TerminalsView />)
    splitWorking()
    closeFirstTab()
    fireEvent.contextMenu(screen.getByText('Close all 2 panes? An agent is still working.'))
    expect(screen.queryByText('Close Others')).toBeNull()
    expect(screen.getByText('Close all 2 panes? An agent is still working.')).toBeTruthy()
  })
})

describe('TerminalsView browser tabs', () => {
  const browserApi = {
    place: vi.fn(),
    setOccluded: vi.fn(),
    operator: vi.fn(() => Promise.resolve()),
    onState: vi.fn(() => () => undefined),
  }
  const stripEl = (): HTMLElement => document.querySelector('.scrollbar-none') as HTMLElement

  beforeEach(() => {
    seed()
    window.executioner = { browser: browserApi } as unknown as typeof window.executioner
    const layouts = [
      ...state().layouts,
      { id: 'browser:b1', root: { type: 'leaf', id: 'pb', item: { kind: 'browser', id: 'b1' } }, focusedLeafId: 'pb' },
    ]
    const sessions = [
      { id: 't1', label: 'Shell 1', agent: 'shell' },
      { id: 't2', label: 'Claude 1', agent: 'claude' },
    ] as never
    const browsers = [{ id: 'b1', url: 'https://a.test/', title: 'Docs', owner: null }]
    // Layout edits re-derive the top level from the engagement, so seed both.
    useApp.setState({
      open: [{ ...state().open[0]!, sessions, browsers, layouts: layouts as never }],
      sessions,
      browsers,
      browserActivity: {},
      browserAsks: {},
      layouts: layouts as never,
    })
  })

  it('a tab with an open ask shows the ask dot', () => {
    render(<TerminalsView />)
    expect(within(stripEl()).queryByLabelText('Needs you')).toBeNull()
    act(() => useApp.setState({ browserAsks: { b1: 'Log in' }, browserActivity: { b1: true } }))
    expect(within(stripEl()).getByLabelText('Needs you')).toBeTruthy()
    // The ask takes precedence over the activity dot.
    expect(within(stripEl()).queryByLabelText('Agent active')).toBeNull()
  })

  it("a split tab that holds the asking browser beside its agent's terminal shows the ask dot", () => {
    // An agent-opened browser sits beside the agent's terminal, and the tab stands for the terminal.
    const layouts = [
      {
        id: 'terminal:t2',
        root: {
          type: 'split',
          dir: 'row',
          ratio: 0.5,
          a: { type: 'leaf', id: 'p2', item: { kind: 'terminal', id: 't2' } },
          b: { type: 'leaf', id: 'pb', item: { kind: 'browser', id: 'b1' } },
        },
        focusedLeafId: 'p2',
      },
      { id: 'terminal:t1', root: { type: 'leaf', id: 'p1', item: { kind: 'terminal', id: 't1' } }, focusedLeafId: 'p1' },
    ]
    useApp.setState({ open: [{ ...state().open[0]!, layouts: layouts as never }], layouts: layouts as never, activeLayoutId: 'terminal:t1' })
    render(<TerminalsView />)
    expect(within(stripEl()).queryByLabelText('Needs you')).toBeNull()
    act(() => useApp.setState({ browserAsks: { b1: 'Log in' } }))
    const dots = within(stripEl()).getAllByLabelText('Needs you')
    expect(dots).toHaveLength(1)
    expect(dots[0]!.parentElement!.textContent).toContain('Claude 1')
    act(() => useApp.setState({ browserAsks: {} }))
    expect(within(stripEl()).queryByLabelText('Needs you')).toBeNull()
  })

  it('a browser tab shows the page title and a background activity dot', () => {
    render(<TerminalsView />)
    expect(within(stripEl()).getByText('Docs')).toBeTruthy()
    expect(within(stripEl()).queryByLabelText('Agent active')).toBeNull()
    act(() => useApp.setState({ browserActivity: { b1: true } }))
    expect(within(stripEl()).getByLabelText('Agent active')).toBeTruthy()
    // The browser is not the active layout: its view is parked.
    expect(browserApi.place).toHaveBeenCalledWith({ root: '/r', id: 'b1', bounds: null })
  })

  it('an empty title reads New tab', () => {
    useApp.setState({ browsers: [{ id: 'b1', url: 'about:blank', title: '', owner: null }] })
    render(<TerminalsView />)
    expect(within(stripEl()).getByText('New tab')).toBeTruthy()
  })

  it('Hand to agent lists agent sessions only and sets the owner', () => {
    const setBrowserOwner = vi.fn(() => Promise.resolve())
    useApp.setState({ setBrowserOwner })
    render(<TerminalsView />)
    fireEvent.contextMenu(within(stripEl()).getByText('Docs'))
    expect(screen.queryByText('Take back')).toBeNull()
    fireEvent.click(screen.getByText('Hand to agent…'))
    const menu = document.querySelector('.z-\\[71\\]') as HTMLElement
    expect(within(menu).queryByText('Shell 1')).toBeNull()
    fireEvent.click(within(menu).getByText('Claude 1'))
    expect(setBrowserOwner).toHaveBeenCalledWith('b1', 't2')
  })

  it('Take back clears the owner', () => {
    const setBrowserOwner = vi.fn(() => Promise.resolve())
    useApp.setState({ setBrowserOwner, browsers: [{ id: 'b1', url: 'https://a.test/', title: 'Docs', owner: 't2' }] })
    render(<TerminalsView />)
    fireEvent.contextMenu(within(stripEl()).getByText('Docs'))
    fireEvent.click(screen.getByText('Take back'))
    expect(setBrowserOwner).toHaveBeenCalledWith('b1', null)
  })

  it('the pane picker offers Browser and fills the pane', () => {
    const openBrowser = vi.fn(() => Promise.resolve())
    useApp.setState({ openBrowser })
    render(<TerminalsView />)
    act(() => state().splitPane('p1', 'row'))
    const root = state().layouts[0]!.root
    const id = root.type === 'split' && root.b.type === 'leaf' ? root.b.id : ''
    const slot = within(screen.getByTestId(`empty-pane-${id}`))
    // An open browser outside this layout is listed under Open.
    expect(slot.getByText('Docs')).toBeTruthy()
    fireEvent.click(slot.getByText('Browser'))
    expect(openBrowser).toHaveBeenCalledWith({ into: id })
  })
})
