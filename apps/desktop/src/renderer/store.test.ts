import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useApp,
  loadSessions,
  saveSessions,
  loadFiles,
  loadTabMeta,
  toPersistedSession,
  toPersistedFile,
  transcriptStem,
  type OpenEngagement,
  type Session,
  type FileTab,
} from './store.js'

/** Seed the store with one active engagement holding a single agent session. */
function seed(): void {
  const engagement = {
    root: '/r',
    name: 'r',
    connection: {} as OpenEngagement['connection'],
    client: {} as OpenEngagement['client'],
    sessions: [{ id: 's1', label: 'claude 1', agent: 'claude' }],
    activeSessionId: 's1',
    sessionState: {},
    subagents: {},
    files: [],
    activeTab: { kind: 'terminal', id: 's1' },
    tabMeta: {},
    editorDrafts: {},
    diskBaselines: {},
    externalMutation: {},
  } satisfies OpenEngagement
  useApp.setState({
    open: [engagement],
    activeRoot: '/r',
    sessions: engagement.sessions,
    activeSessionId: 's1',
    sessionState: {},
    subagents: {},
    files: [],
    activeTab: { kind: 'terminal', id: 's1' },
    tabMeta: {},
  })
}

describe('handleAgentEvent — agent + sub-agent lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seed()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('titles the agent from its first prompt and does not overwrite it', () => {
    const { handleAgentEvent } = useApp.getState()
    handleAgentEvent('s1', 'UserPromptSubmit', { prompt: '  Enumerate  subdomains of example.com  ' })
    expect(useApp.getState().sessions[0]?.title).toBe('Enumerate subdomains of example.com')
    expect(useApp.getState().sessionState.s1).toBe('working')

    handleAgentEvent('s1', 'UserPromptSubmit', { prompt: 'a different later prompt' })
    expect(useApp.getState().sessions[0]?.title).toBe('Enumerate subdomains of example.com')
  })

  it('keeps a sub-agent working through the launch/interim and only the terminal stop marks it done, then ages it out', () => {
    const { handleAgentEvent } = useApp.getState()
    handleAgentEvent('s1', 'subagent-start', { id: 'tu_1', description: 'recon' })
    expect(useApp.getState().subagents.s1).toEqual([{ id: 'tu_1', description: 'recon', state: 'working' }])

    // The lead's own Stop must not touch the running child.
    handleAgentEvent('s1', 'Stop', {})
    expect(useApp.getState().sessionState.s1).toBe('idle')
    expect(useApp.getState().subagents.s1?.[0]?.state).toBe('working')

    // Terminal stop marks done...
    handleAgentEvent('s1', 'subagent-stop', { id: 'tu_1', status: 'completed' })
    expect(useApp.getState().subagents.s1?.[0]?.state).toBe('done')

    // ...and it ages out after the reap delay.
    vi.advanceTimersByTime(8000)
    expect(useApp.getState().subagents.s1).toEqual([])
  })

  it('nests a sub-agent under its parent by parentId and keeps the flat map', () => {
    const { handleAgentEvent } = useApp.getState()
    handleAgentEvent('s1', 'subagent-start', { id: 'p1', description: 'coordinator' })
    handleAgentEvent('s1', 'subagent-start', { id: 'c1', description: 'nested worker', parentId: 'p1' })

    const list = useApp.getState().subagents.s1 ?? []
    expect(list).toEqual([
      { id: 'p1', description: 'coordinator', state: 'working' },
      { id: 'c1', description: 'nested worker', state: 'working', parentId: 'p1' },
    ])
    // A top-level child carries no parentId (exactOptionalPropertyTypes: absent, not undefined).
    expect('parentId' in list[0]!).toBe(false)
  })

  it('ignores events for unknown sessions', () => {
    useApp.getState().handleAgentEvent('nope', 'subagent-start', { id: 'x', description: 'y' })
    expect(useApp.getState().subagents).toEqual({})
    expect(useApp.getState().sessions[0]?.title).toBeUndefined()
  })

  it('learns the claude resume id from a transcript path and persists it', () => {
    const { handleAgentEvent } = useApp.getState()
    handleAgentEvent('s1', 'UserPromptSubmit', {
      prompt: 'hello',
      transcript_path: '/home/u/.claude/projects/r/9f3c-uuid.jsonl',
    })
    expect(useApp.getState().sessions[0]?.resume).toBe('9f3c-uuid')
    // The durable set on disk carries the resume id for a later restart.
    const persisted = loadSessions('/r')
    expect(persisted.find((p) => p.id === 's1')?.resume).toBe('9f3c-uuid')
  })
})

describe('session persistence (serialize/restore)', () => {
  const ROOT = '/persist-test'

  beforeEach(() => {
    localStorage.clear()
  })

  it('derives the resume id from a claude transcript filename stem', () => {
    expect(transcriptStem('/a/b/1234-5678.jsonl')).toBe('1234-5678')
    expect(transcriptStem('C:\\x\\y\\abc.jsonl')).toBe('abc')
    expect(transcriptStem('noext')).toBe('noext')
  })

  it('omits absent optionals when reducing a session (exactOptionalPropertyTypes)', () => {
    const bare = toPersistedSession({ id: 'a', label: 'terminal 1', agent: 'shell' })
    expect(bare).toEqual({ id: 'a', label: 'terminal 1', agent: 'shell' })
    expect('title' in bare).toBe(false)
    expect('resume' in bare).toBe(false)

    const full = toPersistedSession({ id: 'b', label: 'claude 1', agent: 'claude', title: 'recon', resume: 'uuid-1' })
    expect(full).toEqual({ id: 'b', label: 'claude 1', agent: 'claude', title: 'recon', resume: 'uuid-1' })
  })

  it('round-trips sessions through localStorage keyed by root', () => {
    const sessions: Session[] = [
      { id: '1', label: 'terminal 1', agent: 'shell' },
      { id: '2', label: 'claude 1', agent: 'claude', title: 'audit', resume: 'uuid-2' },
    ]
    saveSessions(ROOT, sessions)
    expect(loadSessions(ROOT)).toEqual([
      { id: '1', label: 'terminal 1', agent: 'shell' },
      { id: '2', label: 'claude 1', agent: 'claude', title: 'audit', resume: 'uuid-2' },
    ])
    // Keyed by root: a different root is untouched.
    expect(loadSessions('/other')).toEqual([])
  })

  it('returns an empty set for missing or malformed storage', () => {
    expect(loadSessions('/never-saved')).toEqual([])
    localStorage.setItem('exe.sessions:/bad', 'not json')
    expect(loadSessions('/bad')).toEqual([])
    localStorage.setItem('exe.sessions:/wrong', JSON.stringify([{ nope: true }, { id: 'x', label: 'l', agent: 'a' }]))
    expect(loadSessions('/wrong')).toEqual([{ id: 'x', label: 'l', agent: 'a' }])
  })
})

describe('workspace tabs — files, active tab, rename', () => {
  beforeEach(() => {
    localStorage.clear()
    seed()
  })

  it('opens a file as a tab, dedupes by path, and makes it the active tab', () => {
    const { openFile } = useApp.getState()
    openFile('docs/readme.md', 'readme.md')
    let files = useApp.getState().files
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: 'docs/readme.md', name: 'readme.md' })
    expect('title' in files[0]!).toBe(false)
    const firstId = files[0]!.id
    expect(useApp.getState().activeTab).toEqual({ kind: 'file', id: firstId })
    // Opening the same path again does not add a second tab; it re-activates it.
    openFile('docs/readme.md', 'readme.md')
    files = useApp.getState().files
    expect(files).toHaveLength(1)
    expect(useApp.getState().activeTab).toEqual({ kind: 'file', id: firstId })
    // A file tab is persisted per engagement root.
    expect(loadFiles('/r')).toEqual([{ id: firstId, path: 'docs/readme.md', name: 'readme.md' }])
  })

  it('switches the active tab between terminals and files', () => {
    const { openFile, setActiveTab } = useApp.getState()
    openFile('a.txt', 'a.txt')
    const fileId = useApp.getState().files[0]!.id
    expect(useApp.getState().activeTab).toEqual({ kind: 'file', id: fileId })

    setActiveTab({ kind: 'terminal', id: 's1' })
    expect(useApp.getState().activeTab).toEqual({ kind: 'terminal', id: 's1' })
    expect(useApp.getState().activeSessionId).toBe('s1')

    setActiveTab({ kind: 'file', id: fileId })
    expect(useApp.getState().activeTab).toEqual({ kind: 'file', id: fileId })
  })

  it('closing the active file falls back to a neighbour, then a terminal', () => {
    const { openFile, closeFile } = useApp.getState()
    openFile('a.txt', 'a.txt')
    openFile('b.txt', 'b.txt')
    const [a, b] = useApp.getState().files
    // b is active (opened last); closing it falls back to its neighbour a.
    closeFile(b!.id)
    expect(useApp.getState().files.map((f) => f.id)).toEqual([a!.id])
    expect(useApp.getState().activeTab).toEqual({ kind: 'file', id: a!.id })
    // Closing the last file falls back to the current terminal.
    closeFile(a!.id)
    expect(useApp.getState().files).toHaveLength(0)
    expect(useApp.getState().activeTab).toEqual({ kind: 'terminal', id: 's1' })
  })

  it('renames a file tab and reverts to the filename when cleared', () => {
    const { openFile, renameTab } = useApp.getState()
    openFile('notes.md', 'notes.md')
    const id = useApp.getState().files[0]!.id
    renameTab({ kind: 'file', id }, '  My Notes  ')
    expect(useApp.getState().files[0]?.title).toBe('My Notes')
    expect(loadFiles('/r')[0]?.title).toBe('My Notes')
    // Clearing the title drops the custom label (falls back to the filename).
    renameTab({ kind: 'file', id }, '   ')
    expect('title' in useApp.getState().files[0]!).toBe(false)
    expect('title' in loadFiles('/r')[0]!).toBe(false)
  })

  it('renames a terminal tab via the same action and persists it', () => {
    const { renameTab } = useApp.getState()
    renameTab({ kind: 'terminal', id: 's1' }, 'Recon shell')
    expect(useApp.getState().sessions[0]?.title).toBe('Recon shell')
    expect(loadSessions('/r').find((s) => s.id === 's1')?.title).toBe('Recon shell')
    // Clearing reverts to the default (label), removing the stored title.
    renameTab({ kind: 'terminal', id: 's1' }, '')
    expect('title' in useApp.getState().sessions[0]!).toBe(false)
  })

  it('reduces a file to its persisted shape, omitting an unset title', () => {
    const bare = toPersistedFile({ id: 'f1', path: 'a/b.md', name: 'b.md' })
    expect(bare).toEqual({ id: 'f1', path: 'a/b.md', name: 'b.md' })
    expect('title' in bare).toBe(false)
    const full = toPersistedFile({ id: 'f2', path: 'c.md', name: 'c.md', title: 'C' } as FileTab)
    expect(full).toEqual({ id: 'f2', path: 'c.md', name: 'c.md', title: 'C' })
  })
})

describe('preview (ephemeral) file tabs and promotion', () => {
  beforeEach(() => {
    localStorage.clear()
    seed()
  })

  it('single-click opens an italic preview tab and reuses the one slot', () => {
    const { openFile } = useApp.getState()
    openFile('a.md', 'a.md', { preview: true })
    let files = useApp.getState().files
    expect(files).toHaveLength(1)
    expect(files[0]?.preview).toBe(true)
    const slotId = files[0]!.id

    // Previewing a different file replaces the SAME slot (no second tab).
    openFile('b.md', 'b.md', { preview: true })
    files = useApp.getState().files
    expect(files).toHaveLength(1)
    expect(files[0]?.id).toBe(slotId)
    expect(files[0]).toMatchObject({ path: 'b.md', name: 'b.md', preview: true })
    expect(useApp.getState().activeTab).toEqual({ kind: 'file', id: slotId })
    // A preview tab is not persisted as a preview (restores as permanent).
    expect('preview' in loadFiles('/r')[0]!).toBe(false)
  })

  it('a permanent open of an already-previewed file promotes it (same tab)', () => {
    const { openFile } = useApp.getState()
    openFile('a.md', 'a.md', { preview: true })
    const id = useApp.getState().files[0]!.id
    // Double-click / permanent open of the same path clears the preview flag.
    openFile('a.md', 'a.md', { preview: false })
    const files = useApp.getState().files
    expect(files).toHaveLength(1)
    expect(files[0]?.id).toBe(id)
    expect('preview' in files[0]!).toBe(false)
  })

  it('promoteFileTab clears the preview flag and keeps the tab', () => {
    const { openFile, promoteFileTab } = useApp.getState()
    openFile('a.md', 'a.md', { preview: true })
    const id = useApp.getState().files[0]!.id
    promoteFileTab(id)
    expect('preview' in useApp.getState().files[0]!).toBe(false)
    // Idempotent: promoting a permanent tab is a no-op.
    promoteFileTab(id)
    expect('preview' in useApp.getState().files[0]!).toBe(false)
  })

  it('a preview of an already-open permanent file just re-activates it', () => {
    const { openFile, setActiveTab } = useApp.getState()
    openFile('a.md', 'a.md', { preview: false })
    const id = useApp.getState().files[0]!.id
    setActiveTab({ kind: 'terminal', id: 's1' })
    // Single-clicking the same file again keeps it permanent and re-activates it.
    openFile('a.md', 'a.md', { preview: true })
    expect('preview' in useApp.getState().files[0]!).toBe(false)
    expect(useApp.getState().activeTab).toEqual({ kind: 'file', id })
  })

  it('setFileDirty flips the dirty flag without leaving undefined behind', () => {
    const { openFile, setFileDirty } = useApp.getState()
    openFile('a.txt', 'a.txt', { preview: false })
    const id = useApp.getState().files[0]!.id
    setFileDirty(id, true)
    expect(useApp.getState().files[0]?.dirty).toBe(true)
    setFileDirty(id, false)
    expect('dirty' in useApp.getState().files[0]!).toBe(false)
    // The dirty flag is never persisted.
    expect('dirty' in loadFiles('/r')[0]!).toBe(false)
  })

  it('default openFile (no opts) stays a permanent tab', () => {
    const { openFile } = useApp.getState()
    openFile('a.txt', 'a.txt')
    expect('preview' in useApp.getState().files[0]!).toBe(false)
  })
})

describe('tab pin/color metadata and pinned-protected bulk close', () => {
  beforeEach(() => {
    localStorage.clear()
    seed()
  })

  it('toggles a tab pin, persists it, and clears the entry when unpinned', () => {
    const tab = { kind: 'terminal', id: 's1' } as const
    const { toggleTabPin } = useApp.getState()
    toggleTabPin(tab)
    expect(useApp.getState().tabMeta['terminal:s1']).toEqual({ pinned: true })
    expect(loadTabMeta('/r')).toEqual({ 'terminal:s1': { pinned: true } })

    // Unpinning with no color drops the whole entry (no lingering undefined).
    toggleTabPin(tab)
    expect('terminal:s1' in useApp.getState().tabMeta).toBe(false)
    expect(loadTabMeta('/r')).toEqual({})
  })

  it('sets and clears a tab color independently of pin, without storing undefined', () => {
    const tab = { kind: 'terminal', id: 's1' } as const
    const { setTabColor, toggleTabPin } = useApp.getState()
    setTabColor(tab, '#ef4444')
    expect(useApp.getState().tabMeta['terminal:s1']).toEqual({ color: '#ef4444' })

    // Pin alongside the color: both persist.
    toggleTabPin(tab)
    expect(useApp.getState().tabMeta['terminal:s1']).toEqual({ pinned: true, color: '#ef4444' })
    expect(loadTabMeta('/r')).toEqual({ 'terminal:s1': { pinned: true, color: '#ef4444' } })

    // Clearing the color leaves the pin and never writes an undefined color.
    setTabColor(tab, undefined)
    const meta = useApp.getState().tabMeta['terminal:s1']
    expect(meta).toEqual({ pinned: true })
    expect('color' in meta!).toBe(false)
  })

  it('closeTabsToLeft closes only unpinned tabs to the left', () => {
    // Strip: s1 (terminal), then three files a,b,c.
    const { openFile, toggleTabPin, closeTabsToLeft } = useApp.getState()
    openFile('a.txt', 'a.txt')
    openFile('b.txt', 'b.txt')
    openFile('c.txt', 'c.txt')
    const [a, b, c] = useApp.getState().files
    // Pin the terminal and file a; closing to the left of c must keep both.
    toggleTabPin({ kind: 'terminal', id: 's1' })
    toggleTabPin({ kind: 'file', id: a!.id })

    closeTabsToLeft({ kind: 'file', id: c!.id })
    expect(useApp.getState().sessions.map((s) => s.id)).toEqual(['s1'])
    expect(useApp.getState().files.map((f) => f.id)).toEqual([a!.id, c!.id])
    // b (unpinned, to the left) was closed.
    expect(useApp.getState().files.some((f) => f.id === b!.id)).toBe(false)
  })

  it('closeOtherTabs and closeTabsToRight never close a pinned tab', () => {
    const { openFile, toggleTabPin, closeOtherTabs, closeTabsToRight } = useApp.getState()
    openFile('a.txt', 'a.txt')
    openFile('b.txt', 'b.txt')
    const [a, b] = useApp.getState().files
    // Pin file a; it is the "other" tab that must survive both operations.
    toggleTabPin({ kind: 'file', id: a!.id })

    // Close others relative to the terminal: unpinned b goes, pinned a stays.
    closeOtherTabs({ kind: 'terminal', id: 's1' })
    expect(useApp.getState().files.map((f) => f.id)).toEqual([a!.id])
    expect(useApp.getState().files.some((f) => f.id === b!.id)).toBe(false)

    // Re-open a tab to the right of the terminal and close-to-right; pinned a stays.
    openFile('d.txt', 'd.txt')
    const dId = useApp.getState().files.find((f) => f.path === 'd.txt')!.id
    closeTabsToRight({ kind: 'terminal', id: 's1' })
    expect(useApp.getState().files.map((f) => f.id)).toEqual([a!.id])
    expect(useApp.getState().files.some((f) => f.id === dId)).toBe(false)
  })

  it('drops a tab meta entry when its tab is closed', () => {
    const { openFile, setTabColor, closeFile } = useApp.getState()
    openFile('a.txt', 'a.txt')
    const id = useApp.getState().files[0]!.id
    setTabColor({ kind: 'file', id }, '#22c55e')
    expect(useApp.getState().tabMeta[`file:${id}`]).toEqual({ color: '#22c55e' })
    closeFile(id)
    expect(`file:${id}` in useApp.getState().tabMeta).toBe(false)
    expect(loadTabMeta('/r')).toEqual({})
  })
})

describe('scope-run progress routing', () => {
  beforeEach(() => {
    useApp.setState({ scopeRuns: {} })
  })

  it('routes scope-progress bubbles and a scope-done summary under the runId', () => {
    const { beginScopeRun, handleAgentEvent } = useApp.getState()
    beginScopeRun('run-1')
    handleAgentEvent('run-1', 'scope-progress', { message: 'Added domain example.com' })
    handleAgentEvent('run-1', 'scope-progress', { message: 'Added subdomain api.example.com' })
    const run = useApp.getState().scopeRuns['run-1']!
    expect(run.bubbles.map((b) => b.message)).toEqual([
      'Added domain example.com',
      'Added subdomain api.example.com',
    ])
    expect(run.done).toBe(false)

    handleAgentEvent('run-1', 'scope-done', {
      total: 2,
      added: 2,
      targets: [
        { kind: 'domain', value: 'example.com' },
        { kind: 'subdomain', value: 'api.example.com' },
      ],
    })
    const done = useApp.getState().scopeRuns['run-1']!
    expect(done.done).toBe(true)
    expect(done.summary?.total).toBe(2)
    expect(done.summary?.targets).toHaveLength(2)
  })

  it('does not create a phantom terminal session for scope events', () => {
    useApp.setState({ open: [], activeRoot: null, sessions: [] })
    useApp.getState().handleAgentEvent('run-x', 'scope-progress', { message: 'hi' })
    expect(useApp.getState().sessions).toEqual([])
    expect(useApp.getState().scopeRuns['run-x']?.bubbles[0]?.message).toBe('hi')
  })
})
