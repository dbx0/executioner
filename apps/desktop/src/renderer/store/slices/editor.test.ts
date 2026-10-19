import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../create.js'
import { loadEditorState } from '../persistence.js'
import type { OpenEngagement } from '../types.js'

// closeFile disposes monaco models; the store must stay testable without monaco.
vi.mock('../../lib/monaco-setup.js', () => ({
  monaco: { editor: { getModel: () => null }, Uri: { parse: (v: string) => v } },
}))

/** The slice acts on the active engagement, so every test needs one open. */
function seedEngagement(): void {
  const engagement = {
    root: '/tmp/eng',
    name: 'eng',
    connection: {} as OpenEngagement['connection'],
    client: {} as OpenEngagement['client'],
    sessions: [],
    activeSessionId: null,
    sessionState: {},
    subagents: {},
    files: [{ id: 'f1', path: 'a.txt', name: 'a.txt' }],
    activeTab: { kind: 'file', id: 'f1' },
    tabMeta: {},
    editorDrafts: {},
    diskBaselines: {},
    externalMutation: {},
  } satisfies OpenEngagement
  useApp.setState({
    open: [engagement],
    activeRoot: '/tmp/eng',
    files: engagement.files,
    activeTab: engagement.activeTab,
    tabMeta: {},
    editorDrafts: {},
    diskBaselines: {},
    externalMutation: {},
  })
}

describe('editor slice', () => {
  beforeEach(() => {
    localStorage.clear()
    seedEngagement()
  })

  it('stores and clears a draft', () => {
    useApp.getState().setEditorDraft('f1', 'hello')
    expect(useApp.getState().editorDrafts.f1).toBe('hello')
    useApp.getState().clearEditorDraft('f1')
    expect(useApp.getState().editorDrafts.f1).toBeUndefined()
  })

  it('writes the stat and the signature as one baseline', () => {
    useApp.getState().setDiskBaseline('f1', { stat: { mtimeMs: 10, size: 3 }, signature: 'sig' })
    expect(useApp.getState().diskBaselines.f1).toEqual({
      stat: { mtimeMs: 10, size: 3 },
      signature: 'sig',
    })
  })

  it('sets and clears an external mutation mark', () => {
    useApp.getState().setExternalMutation('f1', 'changed')
    expect(useApp.getState().externalMutation.f1).toBe('changed')
    useApp.getState().setExternalMutation('f1', null)
    expect(useApp.getState().externalMutation.f1).toBeUndefined()
  })

  it('persists drafts and baselines across a reload of the same root', () => {
    useApp.getState().setEditorDraft('f1', 'unsaved work')
    useApp.getState().setDiskBaseline('f1', { stat: { mtimeMs: 10, size: 3 }, signature: 'sig' })
    const stored = loadEditorState('/tmp/eng')
    expect(stored.drafts.f1).toBe('unsaved work')
    expect(stored.baselines.f1).toEqual({ stat: { mtimeMs: 10, size: 3 }, signature: 'sig' })
  })

  it('returns empty state for a root with nothing stored', () => {
    expect(loadEditorState('/tmp/other')).toEqual({ drafts: {}, baselines: {} })
  })

  it('returns empty state rather than throwing on corrupt storage', () => {
    localStorage.setItem('exe.editor:/tmp/eng', 'not json')
    expect(loadEditorState('/tmp/eng')).toEqual({ drafts: {}, baselines: {} })
  })

  it('drops editor state for a tab when it closes', () => {
    useApp.getState().setEditorDraft('f1', 'hello')
    useApp.getState().setDiskBaseline('f1', { stat: { mtimeMs: 1, size: 1 }, signature: 's' })
    useApp.getState().setExternalMutation('f1', 'changed')
    useApp.getState().closeFile('f1')
    expect(useApp.getState().editorDrafts.f1).toBeUndefined()
    expect(useApp.getState().diskBaselines.f1).toBeUndefined()
    expect(useApp.getState().externalMutation.f1).toBeUndefined()
  })
})
