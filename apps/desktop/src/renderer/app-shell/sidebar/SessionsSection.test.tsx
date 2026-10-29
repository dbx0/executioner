import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp, type Session } from '../../store.js'

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
})
