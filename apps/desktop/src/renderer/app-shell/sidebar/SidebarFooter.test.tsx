import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { TooltipProvider } from '../../components/ui/tooltip.js'
import { useApp } from '../../store.js'
import type { ProviderLimits, UsageLimits } from '../../api/usage-limits.js'

vi.stubGlobal('__APP_VERSION__', '0.0.0')


const usage = { get: vi.fn<() => Promise<UsageLimits>>() }
vi.mock('../../api/usage-limits.js', () => ({ usageLimitsApi: () => usage }))

const { SidebarFooter } = await import('./SidebarFooter.js')
const { tightestWindow } = await import('./UsageMeter.js')
const { USAGE_POLL_MS } = await import('../useUsageLimits.js')

function stubLog(verbose: boolean): { fire: (l: 'debug' | 'info') => void } {
  let listener: (l: 'debug' | 'info') => void = () => {}
  Object.assign(window, {
    executioner: {
      log: {
        getVerbose: vi.fn(() => Promise.resolve(verbose)),
        onLevel: vi.fn((cb: typeof listener) => {
          listener = cb
          return () => {}
        }),
      },
    },
  })
  return { fire: (l) => listener(l) }
}

const provider = (over: Partial<ProviderLimits> = {}): ProviderLimits => ({
  provider: 'claude',
  five_hour: { percent: 9, resetsAt: null },
  weekly: { percent: 49, resetsAt: null },
  fable: null,
  plan: null,
  error: null,
  ...over,
})

const limits = (claude: ProviderLimits): UsageLimits => ({
  claude,
  codex: provider({ provider: 'codex', five_hour: null, weekly: null }),
  updatedAt: 0,
})

function renderFooter(): void {
  render(
    <TooltipProvider>
      <SidebarFooter />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  usage.get.mockReset()
  stubLog(false)
  useApp.setState({ client: null, connection: null, activeView: 'terminals' })
})

describe('SidebarFooter verbose indicator', () => {
  it('shows while verbose and hides otherwise', async () => {
    renderFooter()
    await act(async () => {})
    expect(screen.queryByText('Verbose logging')).toBeNull()
  })

  it('shows when verbose logging is already on', async () => {
    stubLog(true)
    renderFooter()
    await screen.findByText('Verbose logging')
  })

  it('follows level changes', async () => {
    const h = stubLog(false)
    renderFooter()
    await act(async () => {})
    act(() => h.fire('debug'))
    expect(screen.getByText('Verbose logging')).toBeTruthy()
    act(() => h.fire('info'))
    expect(screen.queryByText('Verbose logging')).toBeNull()
  })
})

describe('SidebarFooter settings', () => {
  it('leaves the app version to the Settings page', () => {
    renderFooter()
    expect(screen.queryByText(/^v\d/)).toBeNull()
  })

  it('opens Settings, and only with an engagement', () => {
    renderFooter()
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => useApp.setState({ connection: { id: 'e1' } as never }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(useApp.getState().activeView).toBe('settings')
  })
})

describe('SidebarFooter usage meter', () => {
  const meter = (): HTMLElement => screen.getByRole('button', { name: 'Account usage and rate limits' })

  it('is absent without an engine to ask', () => {
    renderFooter()
    expect(screen.queryByRole('button', { name: 'Account usage and rate limits' })).toBeNull()
    expect(usage.get).not.toHaveBeenCalled()
  })

  it('shows a loader until the first fetch lands, then the most consumed window', async () => {
    let land: (l: UsageLimits) => void = () => {}
    usage.get.mockReturnValue(new Promise((resolve) => (land = resolve)))
    useApp.setState({ client: {} as AxiosInstance })
    renderFooter()
    expect(meter().getAttribute('aria-busy')).toBe('true')
    expect(meter().textContent).toContain('Checking usage')
    await act(async () => land(limits(provider())))
    expect(meter().getAttribute('aria-busy')).toBe('false')
    expect(meter().textContent).toContain('49% used')
    expect(meter().textContent).toContain('weekly')
  })

  it('says so when the provider row errored or the fetch failed', async () => {
    usage.get.mockRejectedValue(new Error('down'))
    useApp.setState({ client: {} as AxiosInstance })
    renderFooter()
    await act(async () => {})
    expect(meter().textContent).toContain('Usage unavailable')
  })

  it('says when the account has no limits', async () => {
    usage.get.mockResolvedValue(limits(provider({ five_hour: null, weekly: null })))
    useApp.setState({ client: {} as AxiosInstance })
    renderFooter()
    await act(async () => {})
    expect(meter().textContent).toContain('No account limits')
  })

  it('polls every minute', async () => {
    vi.useFakeTimers()
    try {
      usage.get.mockResolvedValue(limits(provider()))
      useApp.setState({ client: {} as AxiosInstance })
      renderFooter()
      await act(async () => {})
      expect(usage.get).toHaveBeenCalledTimes(1)
      await act(async () => {
        vi.advanceTimersByTime(USAGE_POLL_MS)
      })
      expect(usage.get).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('tightestWindow', () => {
  it('picks the most consumed window and labels it with its time to reset', () => {
    const now = 1_000_000
    const p = provider({
      five_hour: { percent: 80, resetsAt: now + (4 * 60 + 34) * 60_000 },
      weekly: { percent: 49, resetsAt: now + 60_000 },
      fable: { percent: 3, resetsAt: null },
    })
    expect(tightestWindow(p, now)).toEqual({ percent: 80, used: '80% used', detail: 'resets 4h 34m' })
    expect(tightestWindow(provider({ fable: { percent: 90, resetsAt: null } }), now)?.detail).toBe('Fable')
    expect(tightestWindow(provider({ five_hour: null, weekly: null }), now)).toBeNull()
  })
})
