import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../lib/events.js'
import { EMPTY_PAGE, resetToolsStore, subscribeToolEvents, useToolsStore } from './tools-store.js'

const ev = (over: Partial<EngineEvent>): EngineEvent => ({
  type: 'stdout',
  executionId: 'ex-1',
  nodeId: 'nmap',
  data: '',
  seq: 0,
  at: '',
  ...over,
})

beforeEach(() => resetToolsStore())

describe('tools store', () => {
  it('keeps output a run printed before anyone watched it', () => {
    const s = useToolsStore.getState()
    s.ingest('/a', [ev({ data: 'first\n' }), ev({ executionId: 'ex-2', data: 'other\n' })])
    s.watch('/a', 'ex-1')
    s.ingest('/a', [ev({ data: 'second\n' })])
    expect(useToolsStore.getState().runs['/a']!.streams['ex-1']!.chunks).toEqual(['first\n', 'second\n'])
  })

  it('remembers how every run ended, watched or not', () => {
    useToolsStore.getState().ingest('/a', [ev({ type: 'done', executionId: 'ex-9', data: 'failed' })])
    expect(useToolsStore.getState().runs['/a']!.finished).toEqual({ 'ex-9': 'failed' })
  })

  it('drops the oldest output of a very chatty run first', () => {
    const s = useToolsStore.getState()
    s.watch('/a', 'ex-1')
    const big = 'x'.repeat(150_000)
    s.ingest('/a', [ev({ data: 'old' + big }), ev({ data: 'new' + big })])
    const stream = useToolsStore.getState().runs['/a']!.streams['ex-1']!
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]!.startsWith('new')).toBe(true)
  })

  it('keeps each engagement to itself', () => {
    const s = useToolsStore.getState()
    s.update('/a', (p) => ({ ...p, nodeId: 'nmap' }))
    expect(useToolsStore.getState().pages['/a']!.nodeId).toBe('nmap')
    expect(useToolsStore.getState().pages['/b']).toBeUndefined()
    s.ingest('/b', [ev({ type: 'done', data: 'succeeded' })])
    expect(useToolsStore.getState().runs['/a']).toBeUndefined()
    expect(EMPTY_PAGE.backendId).toBe('local')
  })
})

describe('subscribeToolEvents', () => {
  const sockets: FakeSocket[] = []
  class FakeSocket {
    static OPEN = 1
    readyState = 1
    onmessage: ((m: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    constructor(public url: string) {
      sockets.push(this)
    }
    close(): void {
      this.readyState = 3
      this.onclose?.()
    }
  }

  beforeEach(() => {
    sockets.length = 0
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.useFakeTimers()
  })
  afterEach(() => {
    for (const s of sockets) s.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const conn = { port: 1, token: 't', projectRoot: '/eng' }

  it('opens one socket per engine, however often the page mounts', () => {
    subscribeToolEvents(conn)
    subscribeToolEvents(conn)
    expect(sockets).toHaveLength(1)
    subscribeToolEvents({ ...conn, port: 2 })
    expect(sockets).toHaveLength(2)
    expect(sockets[0]!.readyState).toBe(3)
  })

  it('delivers events to the store, even with no page mounted', () => {
    subscribeToolEvents(conn)
    sockets[0]!.onmessage?.({
      data: JSON.stringify({ type: 'done', executionId: 'ex-1', nodeId: 'nmap', data: 'succeeded', seq: 1 }),
    })
    vi.advanceTimersByTime(60)
    expect(useToolsStore.getState().runs['/eng']!.finished['ex-1']).toBe('succeeded')
  })
})
