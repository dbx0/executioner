import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leaf, leaves } from '../../lib/pane-tree.js'
import { useApp } from '../create.js'
import { loadBrowsers } from '../persistence.js'
import type { OpenEngagement } from '../types.js'

vi.mock('../../lib/monaco-setup.js', () => ({
  monaco: { editor: { getModel: () => null }, Uri: { parse: (v: string) => v } },
}))

let nextBrowser = 0
let engineList: { id: string; owner: string | null; url: string; title: string }[] = []
interface Posted {
  id: string
  owner: string | null
  url: string
  title: string
}
const post = vi.fn(async (url: string, body?: { id?: string; url?: string; title?: string }): Promise<{ data: Posted }> => {
  if (url === '/browsers') {
    nextBrowser += 1
    return { data: { id: body?.id ?? `b${nextBrowser}`, owner: null, url: body?.url ?? '', title: body?.title ?? '' } }
  }
  return { data: { id: 't-new', owner: null, url: '', title: '' } }
})
const patch = vi.fn(async (url: string, body: { owner?: string | null }) => ({
  data: { id: url.split('/').pop() ?? '', owner: body.owner ?? null, url: '', title: '' },
}))
const del = vi.fn(async () => ({ data: undefined }))
const get = vi.fn(async () => ({ data: engineList }))

function engagement(root: string, overrides: Partial<OpenEngagement> = {}): OpenEngagement {
  return {
    root,
    name: root,
    connection: {} as OpenEngagement['connection'],
    client: { post, patch, delete: del, get } as unknown as OpenEngagement['client'],
    sessions: [],
    activeSessionId: null,
    sessionState: {},
    subagents: {},
    files: [],
    browsers: [],
    browserActivity: {},
    activeTab: null,
    tabMeta: {},
    editorDrafts: {},
    diskBaselines: {},
    externalMutation: {},
    layouts: [],
    activeLayoutId: null,
    ...overrides,
  }
}

function seed(overrides: Partial<OpenEngagement> = {}): void {
  nextBrowser = 0
  engineList = []
  for (const m of [post, patch, del, get]) m.mockClear()
  localStorage.clear()
  const e = engagement('/r', overrides)
  useApp.setState({
    open: [e],
    activeRoot: '/r',
    client: e.client,
    sessions: e.sessions,
    activeSessionId: e.activeSessionId,
    sessionState: {},
    subagents: {},
    files: [],
    browsers: e.browsers,
    browserActivity: {},
    activeTab: e.activeTab,
    tabMeta: {},
    layouts: e.layouts,
    activeLayoutId: e.activeLayoutId,
  })
}

const state = () => useApp.getState()
const active = () => state().layouts.find((l) => l.id === state().activeLayoutId)
const opened = (id: string, owner: string | null = null) => ({ id, owner, url: '', title: '' })
const session = (id: string) => ({ id, label: id, agent: 'shell' })

describe('browsers in the store', () => {
  beforeEach(() => seed())

  it('openBrowser creates a browser tab in a new layout and activates it', async () => {
    await state().createSession({ kind: 'shell' })
    await state().openBrowser({ url: 'https://example.com' })
    expect(post).toHaveBeenCalledWith('/browsers', { url: 'https://example.com' })
    expect(state().browsers).toEqual([{ id: 'b1', owner: null, url: 'https://example.com', title: '' }])
    expect(state().layouts).toHaveLength(2)
    expect(active()?.root).toMatchObject({ type: 'leaf', item: { kind: 'browser', id: 'b1' } })
    expect(state().activeTab).toEqual({ kind: 'browser', id: 'b1' })
  })

  it('openBrowser into an empty pane fills it', async () => {
    await state().createSession({ kind: 'shell' })
    const emptyLeaf = (): string => {
      const root = active()?.root ?? leaf(null)
      return leaves(root)[leaves(root).length - 1]?.id ?? ''
    }
    state().splitPane(leaves(active()?.root ?? leaf(null))[0]?.id ?? '', 'row')
    const into = emptyLeaf()
    await state().openBrowser({ into })
    expect(state().layouts).toHaveLength(1)
    expect(leaves(active()?.root ?? leaf(null)).find((p) => p.id === into)?.item).toEqual({ kind: 'browser', id: 'b1' })
  })

  it("an agent-opened browser splits beside the agent's terminal", () => {
    seed({ sessions: [session('t1')] })
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    state().handleBrowserEvent('opened', opened('b9', 't1'))
    expect(state().browsers.map((b) => b.id)).toEqual(['b9'])
    expect(state().layouts).toHaveLength(1)
    const items = leaves(active()?.root ?? leaf(null)).map((p) => p.item)
    expect(items).toEqual([
      { kind: 'terminal', id: 't1' },
      { kind: 'browser', id: 'b9' },
    ])
  })

  it("an agent-opened browser beside a background tab does not change the active layout", async () => {
    seed({ sessions: [session('t1'), session('t2')] })
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    const before = state().activeLayoutId
    state().handleBrowserEvent('opened', opened('b9', 't2'))
    expect(state().activeLayoutId).toBe(before)
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
    const t2Layout = state().layouts.find((l) => leaves(l.root).some((p) => p.item?.id === 't2'))
    expect(leaves(t2Layout?.root ?? leaf(null)).map((p) => p.item?.kind)).toEqual(['terminal', 'browser'])
  })

  it('an opened event for an unknown owner adds a background tab without activating it', () => {
    seed({ sessions: [session('t1')] })
    state().setActiveTab({ kind: 'terminal', id: 't1' })
    const before = state().activeLayoutId
    state().handleBrowserEvent('opened', opened('b9', 'gone'))
    expect(state().browsers.map((b) => b.id)).toEqual(['b9'])
    expect(state().layouts).toHaveLength(2)
    expect(state().activeLayoutId).toBe(before)
    expect(state().activeTab).toEqual({ kind: 'terminal', id: 't1' })
  })

  it('an opened event is not applied twice, whichever order it meets the POST response in', async () => {
    post.mockImplementationOnce(async () => {
      state().handleBrowserEvent('opened', opened('b1'))
      return { data: opened('b1') }
    })
    await state().openBrowser()
    state().handleBrowserEvent('opened', opened('b1'))
    expect(state().browsers).toHaveLength(1)
    expect(state().layouts).toHaveLength(1)
    expect(state().activeTab).toEqual({ kind: 'browser', id: 'b1' })
  })

  it('owner and activity events update the tab', async () => {
    await state().openBrowser()
    state().handleBrowserEvent('owner', opened('b1', 't1'))
    expect(state().browsers[0]?.owner).toBe('t1')
    state().handleBrowserEvent('activity', { ...opened('b1', 't1'), active: true })
    expect(state().browserActivity).toEqual({ b1: true })
    state().handleBrowserEvent('closed', opened('b1', 't1'))
    expect(state().browsers).toEqual([])
    expect(state().browserActivity).toEqual({})
    expect(state().layouts).toEqual([])
  })

  it('setBrowserOwner patches the engine and records the owner', async () => {
    await state().openBrowser()
    await state().setBrowserOwner('b1', 't1')
    expect(patch).toHaveBeenCalledWith('/browsers/b1', { owner: 't1' })
    expect(state().browsers[0]?.owner).toBe('t1')
  })

  it('closeBrowser drops the pane and calls DELETE', async () => {
    await state().openBrowser()
    state().closeBrowser('b1')
    expect(del).toHaveBeenCalledWith('/browsers/b1')
    expect(state().browsers).toEqual([])
    expect(state().layouts).toEqual([])
    expect(loadBrowsers('/r')).toEqual([])
  })

  it('closing a pane that holds a browser closes the browser', async () => {
    await state().openBrowser()
    const leafId = leaves(active()?.root ?? leaf(null))[0]?.id ?? ''
    state().closePane(leafId)
    expect(del).toHaveBeenCalledWith('/browsers/b1')
    expect(state().browsers).toEqual([])
  })

  it('syncBrowsers adds missing browsers and drops ones the engine forgot', async () => {
    seed({ browsers: [{ id: 'old', owner: null, url: '', title: '' }] })
    engineList = [opened('new', 't1')]
    await state().syncBrowsers()
    expect(state().browsers.map((b) => b.id)).toEqual(['new'])
    expect(state().browsers[0]?.owner).toBe('t1')
  })

  it("a browser event for one engagement does not touch another", async () => {
    const other = engagement('/other')
    useApp.setState({ open: [...state().open, other] })
    const pending = state().openBrowser()
    useApp.getState().switchEngagement('/other')
    await pending
    expect(state().browsers).toEqual([])
    expect(useApp.getState().open.find((e) => e.root === '/r')?.browsers.map((b) => b.id)).toEqual(['b1'])
  })
})
