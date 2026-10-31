import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../store.js'
import { useBrowserEvents } from './browser-events.js'

class FakeSocket {
  static all: FakeSocket[] = []
  onmessage: ((m: { data: string }) => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  close(): void {
    this.closed = true
  }
  emit(type: string, nodeId: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type, executionId: '', nodeId, data: JSON.stringify(data), seq: 1 }) })
  }
}

const engagement = (root: string, port: number) => ({ root, connection: { port, token: 't', projectRoot: root } }) as never
const handleBrowserEvent = vi.fn()
const socketFor = (port: number): FakeSocket => FakeSocket.all.find((s) => s.url.includes(`:${port}/`) && !s.closed)!

beforeEach(() => {
  FakeSocket.all = []
  handleBrowserEvent.mockClear()
  vi.stubGlobal('WebSocket', FakeSocket)
  useApp.setState({ open: [engagement('/a', 1), engagement('/b', 2)], activeRoot: '/a', handleBrowserEvent })
})
afterEach(() => vi.unstubAllGlobals())

describe('useBrowserEvents', () => {
  it("routes every open engagement's browser events to that engagement, the background one included", () => {
    renderHook(() => useBrowserEvents())
    expect(FakeSocket.all.map((s) => s.url)).toEqual(['ws://127.0.0.1:1/events?token=t', 'ws://127.0.0.1:2/events?token=t'])
    const item = { id: 'b1', url: '', title: '', owner: 's1', message: 'Log in' }
    socketFor(2).emit('browser', 'ask', item)
    expect(handleBrowserEvent).toHaveBeenCalledWith('ask', item, '/b')
    socketFor(1).emit('browser', 'answered', { id: 'b2' })
    expect(handleBrowserEvent).toHaveBeenLastCalledWith('answered', { id: 'b2' }, '/a')
  })

  it('ignores other event types and unknown browser events', () => {
    renderHook(() => useBrowserEvents())
    socketFor(1).emit('agent', 'Notification', {})
    socketFor(1).emit('browser', 'bogus', { id: 'b1' })
    expect(handleBrowserEvent).not.toHaveBeenCalled()
  })

  it('an engagement opening or closing leaves the other sockets alone, and unmount closes them all', () => {
    const { unmount } = renderHook(() => useBrowserEvents())
    const first = socketFor(1)
    act(() => useApp.setState({ open: [engagement('/a', 1), engagement('/c', 3)] }))
    expect(socketFor(1)).toBe(first)
    expect(FakeSocket.all.find((s) => s.url.includes(':2/'))?.closed).toBe(true)
    expect(socketFor(3)).toBeDefined()
    unmount()
    expect(FakeSocket.all.every((s) => s.closed)).toBe(true)
  })
})
