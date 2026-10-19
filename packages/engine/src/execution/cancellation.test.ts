import { describe, expect, it, vi } from 'vitest'
import { CancellationRegistry } from './cancellation.js'

describe('CancellationRegistry', () => {
  it('reports a registered run as cancellable and not yet cancelled', () => {
    const runs = new CancellationRegistry()
    runs.register('e1')
    expect(runs.isRunning('e1')).toBe(true)
    expect(runs.isCancelled('e1')).toBe(false)
  })

  it('cancel marks the run and reports that it took effect', () => {
    const runs = new CancellationRegistry()
    runs.register('e1')
    expect(runs.cancel('e1')).toBe(true)
    expect(runs.isCancelled('e1')).toBe(true)
  })

  it('cancelling a run this process is not executing does nothing', () => {
    const runs = new CancellationRegistry()
    expect(runs.cancel('gone')).toBe(false)
    expect(runs.isCancelled('gone')).toBe(false)
    expect(runs.isRunning('gone')).toBe(false)
  })

  it('runs every hook once, so each live process is killed exactly once', () => {
    const runs = new CancellationRegistry()
    runs.register('e1')
    const killA = vi.fn()
    const killB = vi.fn()
    runs.onCancel('e1', killA)
    runs.onCancel('e1', killB)

    runs.cancel('e1')
    runs.cancel('e1')

    expect(killA).toHaveBeenCalledTimes(1)
    expect(killB).toHaveBeenCalledTimes(1)
  })

  it('a hook that throws does not stop the others', () => {
    const runs = new CancellationRegistry()
    runs.register('e1')
    const after = vi.fn()
    runs.onCancel('e1', () => {
      throw new Error('child already gone')
    })
    runs.onCancel('e1', after)

    expect(() => runs.cancel('e1')).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('a hook registered after the cancel fires at once', () => {
    const runs = new CancellationRegistry()
    runs.register('e1')
    runs.cancel('e1')

    const kill = vi.fn()
    runs.onCancel('e1', kill)
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('releasing a hook keeps a finished node from being killed later', () => {
    const runs = new CancellationRegistry()
    runs.register('e1')
    const kill = vi.fn()
    const release = runs.onCancel('e1', kill)
    release()

    runs.cancel('e1')
    expect(kill).not.toHaveBeenCalled()
  })

  it('a hook for a run it does not know is inert', () => {
    const runs = new CancellationRegistry()
    const kill = vi.fn()
    expect(() => runs.onCancel('gone', kill)()).not.toThrow()
    expect(kill).not.toHaveBeenCalled()
  })

  it('unregister forgets the run, so a late cancel is a no-op', () => {
    const runs = new CancellationRegistry()
    runs.register('e1')
    runs.unregister('e1')
    expect(runs.isRunning('e1')).toBe(false)
    expect(runs.cancel('e1')).toBe(false)
    expect(runs.isCancelled('e1')).toBe(false)
  })
})
