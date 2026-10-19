import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleAutosave } from './autosave.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleAutosave', () => {
  it('saves once after the delay elapses', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    scheduleAutosave({ enabled: true, dirty: true, suspended: false, delayMs: 1000, save })
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not schedule while a conflict is unresolved', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    scheduleAutosave({ enabled: true, dirty: true, suspended: true, delayMs: 1000, save })
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not schedule when disabled or clean', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    scheduleAutosave({ enabled: false, dirty: true, suspended: false, delayMs: 1000, save })
    scheduleAutosave({ enabled: true, dirty: false, suspended: false, delayMs: 1000, save })
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('cancels a pending save when its canceller runs', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const cancel = scheduleAutosave({
      enabled: true,
      dirty: true,
      suspended: false,
      delayMs: 1000,
      save,
    })
    cancel()
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('clamps a delay below the floor', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    scheduleAutosave({ enabled: true, dirty: true, suspended: false, delayMs: 5, save })
    vi.advanceTimersByTime(100)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('clamps a delay above the ceiling', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    scheduleAutosave({ enabled: true, dirty: true, suspended: false, delayMs: 10 ** 9, save })
    vi.advanceTimersByTime(30_000)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
