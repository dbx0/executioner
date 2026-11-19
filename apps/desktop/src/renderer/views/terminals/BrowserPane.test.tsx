import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../../store.js'
import type { BrowserTab } from '../../store/types.js'
import { BrowserPane } from './BrowserPane.js'

const browser: BrowserTab = { id: 'b1', url: 'https://a.test/', title: 'A', owner: null }
const RECT = { x: 10.4, y: 40.6, width: 600.2, height: 300.7 }

const api = {
  place: vi.fn(),
  setOccluded: vi.fn(),
  operator: vi.fn((_req: unknown) => Promise.resolve()),
  onState: vi.fn((_l: (e: { root: string; id: string; state: unknown }) => void) => () => undefined),
}
/** Put an ask where the store keeps it: on the active engagement, mirrored to the top level. */
const setAsk = (message: string | null): void => {
  const browserAsks = message === null ? {} : { b1: message }
  const e = { root: '/r', sessions: useApp.getState().sessions, browsers: [], browserActivity: {}, browserAsks } as never
  act(() => useApp.setState({ open: [e], activeRoot: '/r', browserAsks }))
}
const emit = (state: Record<string, unknown>): void => {
  const listener = api.onState.mock.calls.at(-1)![0]
  act(() => listener({ root: '/engine/root', id: 'b1', state: { url: 'https://a.test/', title: 'A', loading: false, canGoBack: false, canGoForward: false, crashed: false, ...state } }))
}

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
)

beforeEach(() => {
  window.executioner = { browser: api } as unknown as typeof window.executioner
  for (const fn of Object.values(api)) fn.mockClear()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ ...RECT, left: RECT.x, top: RECT.y, right: 0, bottom: 0, toJSON: () => ({}) })
  useApp.setState({
    sessions: [{ id: 's1', label: 'Claude 1', agent: 'claude' }] as never,
    browserActivity: {},
    browserAsks: {},
    expandedBrowserAsk: null,
    open: [],
    activeRoot: null,
  })
})
afterEach(() => vi.restoreAllMocks())

describe('BrowserPane', () => {
  it('reports its page bounds on mount and null on unmount', () => {
    const { unmount } = render(<BrowserPane root="/r" browser={browser} active visible />)
    expect(api.place).toHaveBeenCalledWith({ root: '/r', id: 'b1', bounds: { x: 10, y: 41, width: 600, height: 301 } })
    api.place.mockClear()
    unmount()
    expect(api.place).toHaveBeenCalledWith({ root: '/r', id: 'b1', bounds: null })
  })

  it('reports null while not visible', () => {
    render(<BrowserPane root="/r" browser={browser} active={false} visible={false} />)
    expect(api.place).toHaveBeenCalledWith({ root: '/r', id: 'b1', bounds: null })
    expect(api.place.mock.calls.every(([req]) => (req as { bounds: unknown }).bounds === null)).toBe(true)
  })

  it('Enter in the address bar navigates and adds https when no scheme', () => {
    render(<BrowserPane root="/r" browser={browser} active visible />)
    const input = screen.getByLabelText('Address')
    fireEvent.change(input, { target: { value: 'localhost:3000' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.operator).toHaveBeenLastCalledWith({ root: '/r', id: 'b1', op: { navigate: 'https://localhost:3000' } })
    fireEvent.change(input, { target: { value: 'http://x.test/p' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.operator).toHaveBeenLastCalledWith({ root: '/r', id: 'b1', op: { navigate: 'http://x.test/p' } })
    fireEvent.change(input, { target: { value: 'about:blank' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.operator).toHaveBeenLastCalledWith({ root: '/r', id: 'b1', op: { navigate: 'about:blank' } })
  })

  it('shows a rejected navigation inline instead of crashing', async () => {
    api.operator.mockRejectedValueOnce(new Error('Only http and https'))
    render(<BrowserPane root="/r" browser={browser} active visible />)
    const input = screen.getByLabelText('Address')
    fireEvent.change(input, { target: { value: 'x' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(screen.getByRole('alert').textContent).toBe('Only http and https')
  })

  it('shows the crash state and reloads', () => {
    render(<BrowserPane root="/r" browser={browser} active visible />)
    api.place.mockClear()
    emit({ crashed: true })
    expect(screen.getByText('This page crashed.')).toBeTruthy()
    expect(api.place).toHaveBeenCalledWith({ root: '/r', id: 'b1', bounds: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(api.operator).toHaveBeenCalledWith({ root: '/r', id: 'b1', op: 'reload' })
  })

  it('shows the agent indicator while the owner is acting', () => {
    render(<BrowserPane root="/r" browser={{ ...browser, owner: 's1' }} active visible />)
    expect(screen.queryByText('Claude 1 is using this page')).toBeNull()
    act(() => useApp.setState({ browserActivity: { b1: true } }))
    expect(screen.getByText('Claude 1 is using this page')).toBeTruthy()
  })

  it('the pane shows the ask bar, and Respond opens the modal where Submit answers it', () => {
    const answer = vi.fn(async () => undefined)
    useApp.setState({ answerBrowserAsk: answer })
    render(<BrowserPane root="/r" browser={browser} active visible />)
    expect(screen.queryByText('Solve the captcha')).toBeNull()
    setAsk('Solve the captcha')
    expect(screen.getByText('Solve the captcha')).toBeTruthy()
    // The reply box lives in the modal, not on the bar, until Respond opens it.
    expect(screen.queryByLabelText('Reply to the agent')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(answer).toHaveBeenCalledWith('b1', undefined)
    // Submitting closes the modal.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the ask banner pushes the page down: the reported bounds start below it, and go back after', () => {
    const BANNER = 30
    // Layout as the flex column does it: the banner takes its height off the top of the page area.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const shift = this.matches('[data-browser-page]') && document.querySelector('[data-browser-ask]') !== null ? BANNER : 0
      return { x: 10, y: 40 + shift, width: 600, height: 300 - shift, left: 10, top: 40 + shift, right: 610, bottom: 340, toJSON: () => ({}) }
    })
    render(<BrowserPane root="/r" browser={browser} active visible />)
    expect(api.place).toHaveBeenLastCalledWith({ root: '/r', id: 'b1', bounds: { x: 10, y: 40, width: 600, height: 300 } })
    setAsk('Solve the captcha')
    const banner = document.querySelector('[data-browser-ask]')!
    const page = document.querySelector('[data-browser-page]')!
    // In the DOM the banner comes before the page area, not over it.
    expect(banner.nextElementSibling).toBe(page)
    expect(api.place).toHaveBeenLastCalledWith({ root: '/r', id: 'b1', bounds: { x: 10, y: 70, width: 600, height: 270 } })
    setAsk(null)
    expect(api.place).toHaveBeenLastCalledWith({ root: '/r', id: 'b1', bounds: { x: 10, y: 40, width: 600, height: 300 } })
  })

  it('Submit sends the typed reply, and Enter in the reply does too', () => {
    const answer = vi.fn(async () => undefined)
    useApp.setState({ answerBrowserAsk: answer })
    render(<BrowserPane root="/r" browser={browser} active visible />)
    setAsk('MFA code')
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }))
    const reply = screen.getByLabelText('Reply to the agent')
    fireEvent.change(reply, { target: { value: ' 123456 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(answer).toHaveBeenLastCalledWith('b1', '123456')
    // Reopen and submit by pressing Enter in the reply.
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }))
    const reply2 = screen.getByLabelText('Reply to the agent')
    fireEvent.change(reply2, { target: { value: '654321' } })
    fireEvent.keyDown(reply2, { key: 'Enter' })
    expect(answer).toHaveBeenLastCalledWith('b1', '654321')
  })

  it('Answer later closes the modal but leaves the ask pending', () => {
    const answer = vi.fn(async () => undefined)
    useApp.setState({ answerBrowserAsk: answer })
    render(<BrowserPane root="/r" browser={browser} active visible />)
    setAsk('Solve the captcha')
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }))
    fireEvent.click(screen.getByRole('button', { name: 'Answer later' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(answer).not.toHaveBeenCalled()
    // The bar is still there to reopen.
    expect(screen.getByText('Solve the captcha')).toBeTruthy()
  })

  it('the address bar and operator actions leave the ask in place', () => {
    const answer = vi.fn(async () => undefined)
    useApp.setState({ answerBrowserAsk: answer })
    render(<BrowserPane root="/r" browser={browser} active visible />)
    setAsk('Look')
    const address = screen.getByLabelText('Address')
    fireEvent.click(address)
    fireEvent.change(address, { target: { value: 'x.test' } })
    fireEvent.keyDown(address, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }))
    expect(screen.getByText('Look')).toBeTruthy()
    expect(useApp.getState().browserAsks).toEqual({ b1: 'Look' })
    expect(answer).not.toHaveBeenCalled()
  })

  it('shows the live title and a loading bar', () => {
    render(<BrowserPane root="/r" browser={browser} active visible />)
    emit({ title: 'Fresh', loading: true })
    expect(screen.getByText('Fresh')).toBeTruthy()
    expect(screen.getByTestId('browser-loading')).toBeTruthy()
  })
})
