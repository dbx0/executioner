import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloseGuard } from './close-guard.js'

function setup(native: boolean = true) {
  const deps = {
    ask: vi.fn(),
    askNative: vi.fn(() => Promise.resolve(native)),
    close: vi.fn(),
    quit: vi.fn(),
  }
  return { deps, guard: new CloseGuard({ ...deps, ackTimeoutMs: 1500 }) }
}

describe('CloseGuard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('blocks the first close and asks the renderer once', () => {
    const { deps, guard } = setup()
    expect(guard.shouldBlock('close')).toBe(true)
    expect(guard.shouldBlock('close')).toBe(true)
    expect(deps.ask).toHaveBeenCalledTimes(1)
  })

  it('closes the window when the user confirms a window close', () => {
    const { deps, guard } = setup()
    guard.shouldBlock('close')
    guard.acknowledged()
    guard.answer(true)
    expect(deps.close).toHaveBeenCalledTimes(1)
    expect(deps.quit).not.toHaveBeenCalled()
    expect(guard.shouldBlock('close')).toBe(false)
    expect(guard.shouldBlock('quit')).toBe(false)
  })

  it('quits when the user confirms a quit', () => {
    const { deps, guard } = setup()
    guard.shouldBlock('quit')
    guard.acknowledged()
    guard.answer(true)
    expect(deps.quit).toHaveBeenCalledTimes(1)
    expect(deps.close).not.toHaveBeenCalled()
  })

  it('a quit that arrives while a close is being asked about still quits', () => {
    const { deps, guard } = setup()
    guard.shouldBlock('close')
    guard.shouldBlock('quit')
    guard.answer(true)
    expect(deps.quit).toHaveBeenCalledTimes(1)
  })

  it('keeps the window open on cancel and asks again next time', () => {
    const { deps, guard } = setup()
    guard.shouldBlock('quit')
    guard.acknowledged()
    guard.answer(false)
    expect(deps.close).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
    expect(guard.shouldBlock('close')).toBe(true)
    expect(deps.ask).toHaveBeenCalledTimes(2)
    // The cancelled quit does not linger: confirming this window close only closes.
    guard.answer(true)
    expect(deps.close).toHaveBeenCalledTimes(1)
    expect(deps.quit).not.toHaveBeenCalled()
  })

  it('falls back to the native dialog when the renderer never acknowledges', async () => {
    const { deps, guard } = setup(true)
    guard.shouldBlock('close')
    await vi.advanceTimersByTimeAsync(1500)
    expect(deps.askNative).toHaveBeenCalledTimes(1)
    expect(deps.close).toHaveBeenCalledTimes(1)
  })

  it('does not fall back once the renderer has acknowledged', async () => {
    const { deps, guard } = setup()
    guard.shouldBlock('close')
    guard.acknowledged()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.askNative).not.toHaveBeenCalled()
  })

  it('ignores an answer when nothing was asked', () => {
    const { deps, guard } = setup()
    guard.answer(true)
    expect(deps.close).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
  })

  it('lets everything through after allow(), and asks again after reset()', () => {
    const { deps, guard } = setup()
    guard.allow()
    expect(guard.shouldBlock('quit')).toBe(false)
    expect(deps.ask).not.toHaveBeenCalled()
    guard.reset()
    expect(guard.shouldBlock('close')).toBe(true)
  })
})
