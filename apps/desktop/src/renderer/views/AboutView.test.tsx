import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { Overview } from '../api/overview.js'
import { emitChange } from '../lib/engine-changes.js'

function makeOverview(over: Partial<Overview> = {}): Overview {
  return {
    engagement: {
      root: '/home/h/acme',
      name: 'acme',
      icon: '🎯',
      // Ten days back from whenever the suite runs, so "day 11" holds on any date.
      createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      defaultBackend: 'local',
      description: 'Public API surface only.',
    },
    targets: {
      total: 12,
      byScope: { in: 9, unknown: 2, out: 1 },
      byKind: { subdomain: 8, domain: 3, ip: 1 },
      coverage: { withFindings: 2, reconOnly: 3, untouched: 4 },
      lastSeenAt: '2026-09-22T10:00:00.000Z',
    },
    findings: {
      total: 5,
      bySeverity: { critical: 1, high: 2, medium: 1, low: 1, info: 0 },
      byStatus: { open: 4, confirmed: 1, false_positive: 0, fixed: 0 },
      topTargets: [{ id: 't1', value: 'api.acme.com', findings: 3, worst: 'critical' }],
      lastAt: '2026-09-22T09:00:00.000Z',
    },
    runs: { total: 7, running: 1, succeeded: 5, failed: 1, cancelled: 0, lastAt: '2026-09-22T09:30:00.000Z' },
    scope: { rules: 4, includes: 3, excludes: 1 },
    facts: { total: 40, byKind: { port: 30, technology: 10 } },
    automation: { workflows: 2, schedules: 1, savedAgents: 3 },
    activity: Array.from({ length: 14 }, (_, i) => ({
      date: `2026-09-${String(9 + i).padStart(2, '0')}`,
      findings: i === 13 ? 2 : 0,
      runs: i === 13 ? 1 : 0,
      targets: 0,
    })),
    ...over,
  }
}

/** jsdom lays nothing out, so the clamp has to be simulated: a "tall" paragraph
 *  is one whose scrollHeight exceeds the clamped box. */
function stubClipping(clipped: boolean): void {
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true, value: 360 })
  Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
    configurable: true,
    value: clipped ? 900 : 360,
  })
}

const get = vi.fn(() => Promise.resolve(makeOverview()))
vi.mock('../api/overview.js', () => ({ overviewApi: () => ({ get }) }))

const updateEngagementMeta = vi.fn(() => Promise.resolve())
const closeEngagement = vi.fn()

const { AboutView } = await import('./AboutView.js')

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue(makeOverview())
  stubClipping(false)
  updateEngagementMeta.mockResolvedValue(undefined)
  useApp.setState({
    client: {} as AxiosInstance,
    engagementName: null,
    engagementIcon: null,
    engagementPhoto: null,
    updateEngagementMeta: updateEngagementMeta as never,
    closeEngagement: closeEngagement as never,
    sessions: [
      { id: 's1', label: 'claude', agent: 'claude' },
      { id: 's2', label: 'shell', agent: 'shell' },
    ],
    sessionState: { s1: 'working', s2: 'idle' },
    subagents: { s1: [{ id: 'sub1', description: 'recon', state: 'working' }] },
  })
})

afterEach(() => {
  for (const prop of ['clientHeight', 'scrollHeight'] as const) {
    Reflect.deleteProperty(HTMLDivElement.prototype, prop)
  }
})

describe('AboutView', () => {
  it('heads the page with the engagement identity and its description', async () => {
    render(<AboutView />)
    expect(await screen.findByRole('heading', { name: 'acme' })).toBeTruthy()
    expect(screen.getByText('/home/h/acme')).toBeTruthy()
    expect(screen.getByText('Public API surface only.')).toBeTruthy()
    expect(screen.getByText(/day 11/)).toBeTruthy()
  })

  it('says where the description lives when there is none', async () => {
    get.mockResolvedValue(makeOverview({ engagement: { ...makeOverview().engagement, description: '' } }))
    render(<AboutView />)
    expect(await screen.findByText(/HUNT\.md/)).toBeTruthy()
  })

  it('counts the headline numbers', async () => {
    render(<AboutView />)
    await screen.findByRole('heading', { name: 'acme' })

    const tile = (label: string): HTMLElement =>
      [...document.querySelectorAll('[data-stat]')].find((e) => e.getAttribute('data-stat') === label) as HTMLElement

    expect(tile('In scope').textContent).toContain('9')
    expect(tile('In scope').textContent).toContain('of 12 assets')
    expect(tile('Open findings').textContent).toContain('4')
    // critical + high
    expect(tile('Critical + high').textContent).toContain('3')
    expect(tile('Recon facts').textContent).toContain('40')
  })

  it('reads working agents from the live session state, not the engine', async () => {
    render(<AboutView />)
    await screen.findByRole('heading', { name: 'acme' })
    const tile = [...document.querySelectorAll('[data-stat]')].find(
      (e) => e.getAttribute('data-stat') === 'Agents working',
    ) as HTMLElement
    expect(tile.textContent).toContain('1')
    expect(tile.textContent).toContain('2 open · 1 sub-agents')
  })

  it('charts every severity, including the empty ones', async () => {
    render(<AboutView />)
    await screen.findByText('Findings by severity')
    for (const label of ['Critical', 'High', 'Medium', 'Low', 'Info']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('opens a most-hit asset on the Targets page', async () => {
    render(<AboutView />)
    fireEvent.click(await screen.findByText('api.acme.com'))
    expect(useApp.getState().pendingTargetId).toBe('t1')
    expect(useApp.getState().activeView).toBe('targets')
  })

  it('warns when assets exist with no boundary to judge them against', async () => {
    get.mockResolvedValue(makeOverview({ scope: { rules: 0, includes: 0, excludes: 0 } }))
    render(<AboutView />)
    expect(await screen.findByText(/every asset reads as unscoped/i)).toBeTruthy()
  })

  it('surfaces a failed read instead of an empty page', async () => {
    get.mockRejectedValue(new Error('engine unreachable'))
    render(<AboutView />)
    expect(await screen.findByText('engine unreachable')).toBeTruthy()
  })

  it('blames a stale engine rather than the request when the route is missing', async () => {
    get.mockRejectedValue(Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404 },
    }))
    render(<AboutView />)
    expect(await screen.findByText(/restart the app/i)).toBeTruthy()
  })

  it('leaves a short description alone', async () => {
    render(<AboutView />)
    await screen.findByText('Public API surface only.')
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull()
  })

  it('clamps a long description and expands it on demand', async () => {
    stubClipping(true)
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    get.mockResolvedValue(makeOverview({ engagement: { ...makeOverview().engagement, description: long } }))
    render(<AboutView />)

    await screen.findByText(/line 0/)
    // The clamped box is the measured container, not the markdown inside it.
    const box = document.querySelector('[data-description]') as HTMLElement
    expect(box.style.maxHeight).toBe('360px')
    expect(box.className).toContain('overflow-hidden')

    const toggle = await screen.findByRole('button', { name: /show more/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)

    expect(box.style.maxHeight).toBe('')
    expect(box.className).not.toContain('overflow-hidden')
    const collapse = screen.getByRole('button', { name: /show less/i })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')

    // Collapsing puts the clamp back rather than stranding the page open.
    fireEvent.click(collapse)
    expect(box.style.maxHeight).toBe('360px')
    expect(screen.getByRole('button', { name: /show more/i })).toBeTruthy()
  })

  it('renames the engagement from the pencil beside the name', async () => {
    render(<AboutView />)
    fireEvent.click(await screen.findByRole('button', { name: /rename engagement/i }))

    const input = screen.getByLabelText('Engagement name') as HTMLInputElement
    expect(input.value).toBe('acme')
    fireEvent.change(input, { target: { value: 'acme-2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateEngagementMeta).toHaveBeenCalledWith({ name: 'acme-2026' }))
    await waitFor(() => expect(screen.queryByLabelText('Engagement name')).toBeNull())
  })

  it('saves a rename on Enter and abandons it on Escape', async () => {
    render(<AboutView />)
    fireEvent.click(await screen.findByRole('button', { name: /rename engagement/i }))
    fireEvent.change(screen.getByLabelText('Engagement name'), { target: { value: 'typed' } })
    fireEvent.keyDown(screen.getByLabelText('Engagement name'), { key: 'Escape' })
    expect(updateEngagementMeta).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /rename engagement/i }))
    fireEvent.change(screen.getByLabelText('Engagement name'), { target: { value: 'renamed' } })
    fireEvent.keyDown(screen.getByLabelText('Engagement name'), { key: 'Enter' })
    await waitFor(() => expect(updateEngagementMeta).toHaveBeenCalledWith({ name: 'renamed' }))
  })

  it('does not write a rename that changes nothing', async () => {
    render(<AboutView />)
    fireEvent.click(await screen.findByRole('button', { name: /rename engagement/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateEngagementMeta).not.toHaveBeenCalled()
  })

  it('changes the badge from the icon picker', async () => {
    render(<AboutView />)
    fireEvent.click(await screen.findByRole('button', { name: /change engagement icon/i }))
    fireEvent.click(screen.getByRole('option', { name: '🐛' }))
    await waitFor(() => expect(updateEngagementMeta).toHaveBeenCalledWith({ icon: '🐛', photo: '' }))
  })

  it('closes the engagement from the header', async () => {
    render(<AboutView />)
    fireEvent.click(await screen.findByRole('button', { name: /close engagement/i }))
    expect(closeEngagement).toHaveBeenCalled()
  })

  it('re-reads on demand', async () => {
    render(<AboutView />)
    await screen.findByRole('heading', { name: 'acme' })
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it('refetches on a findings change', async () => {
    render(<AboutView />)
    await screen.findByRole('heading', { name: 'acme' })
    expect(get).toHaveBeenCalledTimes(1)

    emitChange('findings')

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })
})
