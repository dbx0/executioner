import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emitChange, onChange, useEngineChange } from './engine-changes.js'

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve))

describe('engine-changes', () => {
  it('onChange runs the callback for a subscribed topic only', async () => {
    const cb = vi.fn()
    const off = onChange(['targets'], cb)
    emitChange('findings')
    await tick()
    expect(cb).not.toHaveBeenCalled()
    emitChange('targets')
    await tick()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it('unsubscribe stops delivery', async () => {
    const cb = vi.fn()
    const off = onChange(['scope'], cb)
    off()
    emitChange('scope')
    await tick()
    expect(cb).not.toHaveBeenCalled()
  })

  it('many emits in one tick call the callback once', async () => {
    const cb = vi.fn()
    const off = onChange(['runs', 'sessions'], cb)
    emitChange('runs')
    emitChange('runs')
    emitChange('sessions')
    await tick()
    await tick()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it('useEngineChange uses the latest callback', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(({ cb }) => useEngineChange(['findings'], cb), {
      initialProps: { cb: first },
    })
    rerender({ cb: second })
    emitChange('findings')
    await tick()
    await tick()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
  })
})
