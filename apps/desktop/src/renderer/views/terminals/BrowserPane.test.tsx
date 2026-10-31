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

  it('shows the live title and a loading bar', () => {
    render(<BrowserPane root="/r" browser={browser} active visible />)
    emit({ title: 'Fresh', loading: true })
    expect(screen.getByText('Fresh')).toBeTruthy()
    expect(screen.getByTestId('browser-loading')).toBeTruthy()
  })
})
