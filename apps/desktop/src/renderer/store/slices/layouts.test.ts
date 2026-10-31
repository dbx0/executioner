import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../create.js'
import type { OpenEngagement } from '../types.js'
import { closeConfirmation } from './layouts.js'
import { leaf, splitLeaf } from '../../lib/pane-tree.js'

vi.mock('../../lib/monaco-setup.js', () => ({
  monaco: { editor: { getModel: () => null }, Uri: { parse: (v: string) => v } },
}))

let nextTerminal = 0
const post = vi.fn(async () => {
  nextTerminal += 1
  return { data: { id: `t${nextTerminal}` } }
})

function seed(): void {
  nextTerminal = 0
  post.mockClear()
  const engagement = {
    root: '/r',
    name: 'r',
    connection: {} as OpenEngagement['connection'],
    client: { post } as unknown as OpenEngagement['client'],
    sessions: [],
    activeSessionId: null,
    sessionState: {},
    subagents: {},
    files: [],
    browsers: [],
    browserActivity: {},
    browserAsks: {},
    activeTab: null,
    tabMeta: {},
    editorDrafts: {},
    diskBaselines: {},
    externalMutation: {},
    layouts: [],
    activeLayoutId: null,
  } satisfies OpenEngagement
  useApp.setState({
    open: [engagement],
    activeRoot: '/r',
    client: engagement.client,
    sessions: [],
    activeSessionId: null,
    sessionState: {},
    subagents: {},
    files: [],
    activeTab: null,
    tabMeta: {},
    layouts: [],
    activeLayoutId: null,
  })
}

const state = () => useApp.getState()
const active = () => state().layouts.find((l) => l.id === state().activeLayoutId)

describe('layouts in the store', () => {
  beforeEach(seed)

  it('a new session gets its own single-pane layout and becomes active', async () => {
    await state().createSession({ kind: 'shell' })
    expect(state().layouts).toHaveLength(1)
    expect(active()?.root).toMatchObject({ type: 'leaf', item: { kind: 'terminal', id: 't1' } })
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
    await state().createSession({ kind: 'shell' })
    expect(state().layouts).toHaveLength(2)
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't2' })
  })

  it('splitPane leaves an empty focused pane', async () => {
    await state().createSession({ kind: 'shell' })
    const first = active()!
    const leafId = first.focusedLeafId
    state().splitPane(leafId, 'row')
    const layout = active()!
    expect(layout.root).toMatchObject({ type: 'split', dir: 'row' })
    expect(layout.focusedLeafId).not.toBe(leafId)
    expect(state().activeTab).toBeNull()
    expect(state().layouts).toHaveLength(1)
  })

  it('createSession into an empty pane fills it instead of opening a tab', async () => {
    await state().createSession({ kind: 'shell' })
    state().splitPane(active()!.focusedLeafId, 'row')
    const emptyLeaf = active()!.focusedLeafId
    await state().createSession({ kind: 'shell' }, { into: emptyLeaf })
    expect(state().layouts).toHaveLength(1)
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't2' })
    expect(active()!.focusedLeafId).toBe(emptyLeaf)
  })

  it('fillPane with an item from another layout moves it and drops the emptied layout', async () => {
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    const t1Layout = state().layouts[0]!.id
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    state().splitPane(active()!.focusedLeafId, 'row')
    const emptyLeaf = active()!.focusedLeafId
    state().fillPane(emptyLeaf, { kind: 'terminal', id: 't2' })
    expect(state().layouts).toHaveLength(1)
    expect(state().layouts[0]!.id).toBe(t1Layout)
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't2' })
    expect(state().sessions).toHaveLength(2)
  })

  it('closing the last pane of the active layout activates the neighbour layout', async () => {
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    state().setActiveTab({ kind: 'terminal', id: 't2' })
    state().closeSession('t2')
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
    state().closeSession('t1')
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't3' })
    expect(state().layouts).toHaveLength(1)
  })

  it('closing one of two panes focuses the sibling', async () => {
    await state().createSession({ kind: 'shell' })
    const a = active()!.focusedLeafId
    state().splitPane(a, 'row')
    const b = active()!.focusedLeafId
    await state().createSession({ kind: 'shell' }, { into: b })
    expect(active()!.focusedLeafId).toBe(b)
    state().closePane(b)
    expect(active()!.root).toMatchObject({ type: 'leaf', id: a })
    expect(active()!.focusedLeafId).toBe(a)
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
    expect(state().sessions.map((s) => s.id)).toEqual(['t1'])
  })

  it('movePaneToNewTab creates a layout after the current one', async () => {
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    state().splitPane(active()!.focusedLeafId, 'row', { kind: 'terminal', id: 't2' })
    expect(state().layouts).toHaveLength(1)
    await state().createSession({ kind: 'shell' })
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    const moving = active()!.focusedLeafId
    state().movePaneToNewTab(moving)
    const ids = state().layouts.map((l) => l.id)
    expect(ids).toHaveLength(3)
    expect(state().activeLayoutId).toBe(ids[1])
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
    expect(state().layouts[0]!.root.type).toBe('leaf')
  })

  it('splitBeside places the new item next to the given item without stealing focus from another layout', async () => {
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    const before = state().activeLayoutId
    state().splitBeside({ kind: 'terminal', id: 't3' }, 'row', { kind: 'terminal', id: 't2' })
    expect(state().activeLayoutId).toBe(before)
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
    const t3Layout = state().layouts.find((l) => l.id === 'terminal:t3')!
    expect(t3Layout.root).toMatchObject({ type: 'split', dir: 'row' })
    expect(state().layouts.some((l) => l.id === 'terminal:t2')).toBe(false)
    state().setActiveTab({ kind: 'terminal', id: 't3' })
    state().splitBeside({ kind: 'terminal', id: 't3' }, 'col', { kind: 'file', id: 'f9' })
    expect(state().activeTab).toEqual({ kind: 'file', id: 'f9' })
  })

  it('setActiveTab on an item in a background layout activates that layout and focuses the item', async () => {
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    state().splitPane(active()!.focusedLeafId, 'row', { kind: 'terminal', id: 't1' })
    state().setActiveTab({ kind: 'terminal', id: 't2' })
    expect(state().layouts).toHaveLength(1)
    state().focusPane(state().layouts[0]!.id, active()!.focusedLeafId)
    await state().createSession({ kind: 'shell' })
    expect(state().activeLayoutId).not.toBe('terminal:t2')
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    expect(state().activeLayoutId).toBe('terminal:t2')
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
    expect(state().activeSessionId).toBe('t1')
  })

  it('bulk close keeps pinned layouts', async () => {
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    await state().createSession({ kind: 'shell' })
    state().toggleTabPin({ kind: 'terminal', id: 't2' })
    state().closeOtherTabs({ kind: 'terminal', id: 't1' })
    expect(state().sessions.map((s) => s.id)).toEqual(['t1', 't2'])
    expect(state().layouts.map((l) => l.id)).toEqual(['terminal:t1', 'terminal:t2'])
  })

  it("layout id is the creating item's key, or a fresh id when taken", async () => {
    await state().createSession({ kind: 'shell' })
    expect(state().layouts[0]!.id).toBe('terminal:t1')
    await state().createSession({ kind: 'shell' })
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    state().splitPane(active()!.focusedLeafId, 'row', { kind: 'terminal', id: 't2' })
    const taken = state().layouts.some((l) => l.id === 'terminal:t1')
    expect(taken).toBe(true)
    const root = active()!.root
    if (root.type !== 'split' || root.a.type !== 'leaf') throw new Error('expected a split')
    state().movePaneToNewTab(root.a.id)
    const ids = state().layouts.map((l) => l.id)
    expect(ids[0]).toBe('terminal:t1')
    expect(ids[1]).toMatch(/^layout:/)
  })
})

describe('closeConfirmation', () => {
  const split = (): Parameters<typeof closeConfirmation>[0] => {
    const one = splitLeaf(leaf({ kind: 'terminal', id: 't1' }, 'a'), 'a', 'row', { kind: 'terminal', id: 't2' })
    return { id: 'l', root: one.root, focusedLeafId: 'a' }
  }

  it('asks when a split layout holds a working agent', () => {
    const sessions = [{ id: 't1', agent: 'shell' }, { id: 't2', agent: 'claude' }]
    expect(closeConfirmation(split(), sessions, { t2: 'working' })).toBe('Close all 2 panes? An agent is still working.')
  })

  it('does not ask when the only working session is a shell', () => {
    const sessions = [{ id: 't1', agent: 'shell' }, { id: 't2', agent: 'shell' }]
    expect(closeConfirmation(split(), sessions, { t2: 'working' })).toBeNull()
  })

  it('does not ask when the agent in the split is idle or has no state yet', () => {
    const sessions = [{ id: 't1', agent: 'shell' }, { id: 't2', agent: 'claude' }]
    expect(closeConfirmation(split(), sessions, { t2: 'idle' })).toBeNull()
    expect(closeConfirmation(split(), sessions, {})).toBeNull()
  })
})
