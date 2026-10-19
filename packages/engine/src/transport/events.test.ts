import { describe, expect, it, vi } from 'vitest'
import { EventBus } from './events.js'

describe('EventBus', () => {
  it('delivers a published event to a subscriber', () => {
    const bus = new EventBus()
    const seen = vi.fn()
    bus.subscribe(seen)
    bus.publish({ type: 'status', executionId: 'e1', nodeId: 'n1', data: 'running' })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0]).toMatchObject({ type: 'status', nodeId: 'n1' })
  })

  it('stamps every event with a monotonic sequence number', () => {
    const bus = new EventBus()
    const seen: number[] = []
    bus.subscribe((e) => seen.push(e.seq))
    bus.publish({ type: 'stdout', executionId: 'e1', nodeId: 'n1', data: 'a' })
    bus.publish({ type: 'stdout', executionId: 'e1', nodeId: 'n1', data: 'b' })
    expect(seen).toEqual([1, 2])
  })

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus()
    const seen = vi.fn()
    const off = bus.subscribe(seen)
    off()
    bus.publish({ type: 'done', executionId: 'e1', nodeId: 'n1', data: '' })
    expect(seen).not.toHaveBeenCalled()
  })

  it('delivers to every subscriber', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe(a)
    bus.subscribe(b)
    bus.publish({ type: 'done', executionId: 'e1', nodeId: 'n1', data: '' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('does not let one throwing subscriber block the others', () => {
    const bus = new EventBus()
    const good = vi.fn()
    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe(good)
    expect(() =>
      bus.publish({ type: 'done', executionId: 'e1', nodeId: 'n1', data: '' }),
    ).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
  })
})
