import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { useApp } from '../../store.js'
import type { AxiosInstance } from 'axios'

const parse = vi.fn(async () => ({ runId: 'run-1' }))
vi.mock('../../api/scope.js', () => ({ scopeApi: () => ({ parse }) }))

const { NewEngagementModal } = await import('./NewEngagementModal.js')

beforeEach(() => {
  useApp.setState({ newEngagementOpen: true, newEngagementTab: 'ai', error: null, busy: false, scopeRuns: {}, recents: [], open: [] })
})

afterEach(() => {
  cleanup()
  useApp.setState({ newEngagementOpen: false })
})

describe('NewEngagementModal', () => {
  it('renders all three mode tabs and the AI scope help text', () => {
    render(<NewEngagementModal />)
    expect(screen.getByRole('tab', { name: 'Start with AI' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Manual' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Open existing' })).toBeTruthy()
    expect(screen.getByText(/Paste the scope from HackerOne\/Bugcrowd/)).toBeTruthy()
  })

  it('opens on the tab the caller asked for', () => {
    useApp.setState({ newEngagementTab: 'open' })
    render(<NewEngagementModal />)
    expect(screen.getByRole('tab', { name: 'Open existing' }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows a chosen photo as the engagement badge', async () => {
    const photo = 'data:image/png;base64,AAAA'
    vi.stubGlobal(
      'window',
      Object.assign(window, { executioner: { pickEngagementPhoto: vi.fn(async () => photo) } }),
    )
    const { container } = render(<NewEngagementModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Engagement icon' }))
    fireEvent.click(screen.getByRole('button', { name: /Use a photo/ }))

    // The badge is decorative (the field is labelled), so it is found by tag.
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(photo))
  })

  it('normalizes a wildcard target to its parent in the Manual tab', () => {
    render(<NewEngagementModal />)
    fireEvent.click(screen.getByRole('tab', { name: 'Manual' }))
    const input = screen.getByPlaceholderText(/example.com, api.example.com/)
    fireEvent.change(input, { target: { value: '*.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    // The wildcard collapses to the parent domain, shown as a domain chip.
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.queryByText('*.example.com')).toBeNull()
  })

  it('lists a card per remembered engagement on the Open existing tab', () => {
    useApp.setState({
      recents: [
        { root: '/home/x/acme', name: 'acme', icon: '🎯', lastOpenedAt: Date.now() },
        { root: '/home/x/globex', name: 'globex' },
      ],
    })
    render(<NewEngagementModal />)
    fireEvent.click(screen.getByRole('tab', { name: 'Open existing' }))
    const acme = screen.getByRole('button', { name: /acme/ })
    expect(screen.getByRole('button', { name: /globex/ })).toBeTruthy()
    // Clicking a card selects it, which is what the Open button then acts on.
    expect(acme.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(acme)
    expect(acme.getAttribute('aria-pressed')).toBe('true')
  })

  it('falls back to the folder picker when there are no recents', () => {
    render(<NewEngagementModal />)
    fireEvent.click(screen.getByRole('tab', { name: 'Open existing' }))
    expect(screen.queryByText('Recent engagements')).toBeNull()
    expect(screen.getByText('Choose an existing engagement folder…')).toBeTruthy()
  })

  it('does not render when closed', () => {
    useApp.setState({ newEngagementOpen: false })
    const { container } = render(<NewEngagementModal />)
    expect(container.firstChild).toBeNull()
  })

  describe('Start with AI', () => {
    beforeEach(() => {
      parse.mockClear()
      useApp.setState({
        client: {} as AxiosInstance,
        defaultAgent: 'claude',
        createEngagement: vi.fn(async () => '/home/x/acme') as never,
        pickEngagementFolder: vi.fn(async () => '/home/x/acme') as never,
        beginScopeRun: vi.fn() as never,
      })
    })

    it('hands the program notes to the same run that parses the scope', async () => {
      render(<NewEngagementModal />)
      fireEvent.click(screen.getByText('Choose folder…'))
      await waitFor(() => expect(screen.getByDisplayValue('acme')).toBeTruthy())

      fireEvent.change(screen.getByPlaceholderText(/What is this program/), {
        target: { value: 'pays 500 for rce. no DoS.' },
      })
      fireEvent.change(screen.getByPlaceholderText(/api\.example\.com/), { target: { value: '*.example.com' } })
      fireEvent.click(screen.getByRole('button', { name: /create with ai/i }))

      await waitFor(() =>
        expect(parse).toHaveBeenCalledWith({
          scope: '*.example.com',
          agent: 'claude',
          description: 'pays 500 for rce. no DoS.',
        }),
      )
    })

    it('leaves the brief out when the operator wrote none', async () => {
      render(<NewEngagementModal />)
      fireEvent.click(screen.getByText('Choose folder…'))
      await waitFor(() => expect(screen.getByDisplayValue('acme')).toBeTruthy())

      fireEvent.change(screen.getByPlaceholderText(/api\.example\.com/), { target: { value: '*.example.com' } })
      fireEvent.click(screen.getByRole('button', { name: /create with ai/i }))

      await waitFor(() => expect(parse).toHaveBeenCalledWith({ scope: '*.example.com', agent: 'claude' }))
    })
  })
})