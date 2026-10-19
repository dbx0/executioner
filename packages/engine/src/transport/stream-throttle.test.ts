import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventBus } from './events.js'
import { createStreamThrottle } from './stream-throttle.js'

describe('createStreamThrottle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces a burst of chunks into a single event after the interval', () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.subscribe((e) => {
      if (e.type === 'stdout') seen.push(e.data)
    })
    const s = createStreamThrottle({ bus, type: 'stdout', executionId: 'e1', nodeId: 'n1', intervalMs: 60 })

    for (let i = 0; i < 1000; i += 1) s.push(`line-${i}\n`)
    expect(seen).toHaveLength(0) // nothing published mid-burst
    vi.advanceTimersByTime(60)
    expect(seen).toHaveLength(1) // one coalesced frame, not 1000
    expect(seen[0]).toContain('line-0')
    expect(seen[0]).toContain('line-999')
  })

  it('flushes immediately once the buffer exceeds maxChars', () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.subscribe((e) => e.type === 'stdout' && seen.push(e.data))
    const s = createStreamThrottle({ bus, type: 'stdout', executionId: 'e', nodeId: 'n', maxChars: 100 })
    s.push('x'.repeat(150))
    expect(seen).toHaveLength(1) // size-triggered, no timer wait
  })

  it('flush() emits pending text and cancels the timer', () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.subscribe((e) => e.type === 'stdout' && seen.push(e.data))
    const s = createStreamThrottle({ bus, type: 'stdout', executionId: 'e', nodeId: 'n' })
    s.push('tail')
    s.flush()
    expect(seen).toEqual(['tail'])
    vi.advanceTimersByTime(1000)
    expect(seen).toHaveLength(1) // timer did not double-emit
  })
})
