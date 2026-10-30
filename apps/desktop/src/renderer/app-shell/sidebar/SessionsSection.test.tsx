import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp, type Session } from '../../store.js'
import { leaf, splitLeaf } from '../../lib/pane-tree.js'
import type { Layout, OpenEngagement } from '../../store/types.js'

// The spawn menu reaches for the teams API on mount; the "+" affordance itself
// is all this file cares about.
vi.mock('../../components/SpawnMenu.js', () => ({
  SpawnMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { SessionsSection } = await import('./SessionsSection.js')

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  label: 'bash',
  agent: 'shell',
  ...over,
})

describe('SessionsSection', () => {
  beforeEach(() => {
    useApp.setState({ sessions: [], files: [], sessionState: {}, subagents: {}, activeSessionId: null })
  })

  it('lists agents and terminals under one Sessions heading', () => {
    useApp.setState({
      sessions: [
        session({ id: 'a1', agent: 'claude', label: 'claude', title: 'recon' }),
        session({ id: 't1', agent: 'shell', label: 'bash' }),
      ],
    })
    render(<SessionsSection />)

    expect(screen.getByText('Sessions')).toBeTruthy()
    expect(screen.queryByText('Terminals')).toBeNull()
    expect(screen.queryByText('Agents')).toBeNull()
    expect(screen.getByText('recon')).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
  })

  it('keeps agents above terminals in the merged list', () => {
    useApp.setState({
      sessions: [
        session({ id: 't1', agent: 'shell', label: 'bash' }),
        session({ id: 'a1', agent: 'claude', label: 'claude', title: 'recon' }),
      ],
    })
    render(<SessionsSection />)

    const order = screen.getByText('recon').compareDocumentPosition(screen.getByText('bash'))
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows one empty state covering both kinds', () => {
    render(<SessionsSection />)
    expect(screen.getByText(/no sessions/i)).toBeTruthy()
  })

  it('offers a single new-session button', () => {
    useApp.setState({ sessions: [session({ id: 't1' })] })
    render(<SessionsSection />)
    expect(screen.getAllByRole('button', { name: /new session/i })).toHaveLength(1)
  })

  it('an idle agent session shows the idle dot', () => {
    useApp.setState({ sessions: [session({ id: 'a1', agent: 'claude', label: 'claude', title: 'recon' })] })
    render(<SessionsSection />)
    expect(screen.getByLabelText('idle')).toBeTruthy()
    expect(screen.queryByLabelText('working')).toBeNull()
  })

  it('a working agent session shows the working dot and no idle dot', () => {
    useApp.setState({
      sessions: [session({ id: 'a1', agent: 'claude', label: 'claude', title: 'recon' })],
      sessionState: { a1: 'working' },
    })
    render(<SessionsSection />)
    expect(screen.getByLabelText('working')).toBeTruthy()
    expect(screen.queryByLabelText('idle')).toBeNull()
  })

  it('an idle shell row shows no dot', () => {
    useApp.setState({ sessions: [session({ id: 't1', agent: 'shell', label: 'bash' })] })
    render(<SessionsSection />)
    expect(screen.queryByLabelText('idle')).toBeNull()
    expect(screen.queryByLabelText('working')).toBeNull()
  })

  it('clicking a session in the sidebar focuses its pane in a background layout', () => {
    const split = leaf({ kind: 'terminal', id: 'a' }, 'pa')
    const two = splitLeaf(split, 'pa', 'row', { kind: 'terminal', id: 'b' })
    const sessions = [
      session({ id: 'a', label: 'one' }),
      session({ id: 'b', label: 'two' }),
      session({ id: 'c', label: 'three' }),
    ]
    const layouts: Layout[] = [
      { id: 'terminal:a', root: two.root, focusedLeafId: 'pa' },
      { id: 'terminal:c', root: leaf({ kind: 'terminal', id: 'c' }, 'pc'), focusedLeafId: 'pc' },
    ]
    const engagement = {
      root: '/r',
      sessions,
      files: [],
      layouts,
      activeLayoutId: 'terminal:c',
      activeTab: { kind: 'terminal', id: 'c' },
      activeSessionId: 'c',
      sessionState: {},
      subagents: {},
      tabMeta: {},
      editorDrafts: {},
      diskBaselines: {},
      externalMutation: {},
    } as unknown as OpenEngagement
    useApp.setState({
      open: [engagement],
      activeRoot: '/r',
      sessions,
      layouts,
      activeLayoutId: 'terminal:c',
      activeTab: { kind: 'terminal', id: 'c' },
      activeSessionId: 'c',
    })
    render(<SessionsSection />)
    fireEvent.click(screen.getByText('two'))
    expect(useApp.getState().activeLayoutId).toBe('terminal:a')
    expect(useApp.getState().layouts[0]!.focusedLeafId).toBe(two.newLeafId)
    expect(useApp.getState().activeSessionId).toBe('b')
  })
})
