import { describe, expect, it, vi } from 'vitest'
import { checkDiskState, type DiskCheckParams } from './useDiskWatch.js'
import { getDiskBaselineSignature } from './signature.js'

function makeParams(overrides: Partial<DiskCheckParams> = {}): DiskCheckParams {
  return {
    path: 'a.txt',
    isDirty: false,
    baseline: { stat: { mtimeMs: 1, size: 5 }, signature: getDiskBaselineSignature('hello') },
    isWriteInFlight: () => false,
    stat: async () => ({ path: 'a.txt', mtimeMs: 1, size: 5 }),
    read: async () => ({ path: 'a.txt', content: 'hello', truncated: false, mtimeMs: 1, size: 5 }),
    onReload: vi.fn(),
    onConflict: vi.fn(),
    onDeleted: vi.fn(),
    onRebaseline: vi.fn(),
    ...overrides,
  }
}

describe('checkDiskState', () => {
  it('does nothing when the stat is unchanged', async () => {
    const params = makeParams()
    expect(await checkDiskState(params)).toBe('unchanged')
    expect(params.onReload).not.toHaveBeenCalled()
    expect(params.onConflict).not.toHaveBeenCalled()
  })

  it('skips a path with a write in flight', async () => {
    const stat = vi.fn()
    const params = makeParams({ isWriteInFlight: () => true, stat: stat as never })
    expect(await checkDiskState(params)).toBe('skipped')
    // Our own write is mid-flight; statting now would compare a new mtime
    // against the pre-write baseline and raise a false conflict.
    expect(stat).not.toHaveBeenCalled()
  })

  it('treats a missing baseline as nothing to compare against', async () => {
    const params = makeParams({ baseline: undefined })
    expect(await checkDiskState(params)).toBe('skipped')
  })

  it('refreshes the stat without a conflict for a byte-identical rewrite', async () => {
    // The rebaseline comes from the read, not the earlier stat: content and
    // mtime have to come from one call or they can describe different states.
    const params = makeParams({
      isDirty: true,
      stat: async () => ({ path: 'a.txt', mtimeMs: 999, size: 5 }),
      read: async () => ({ path: 'a.txt', content: 'hello', truncated: false, mtimeMs: 999, size: 5 }),
    })
    expect(await checkDiskState(params)).toBe('refreshed-stat')
    expect(params.onConflict).not.toHaveBeenCalled()
    expect(params.onRebaseline).toHaveBeenCalledWith({
      stat: { mtimeMs: 999, size: 5 },
      signature: getDiskBaselineSignature('hello'),
    })
  })

  it('reloads silently when the buffer is clean', async () => {
    const params = makeParams({
      stat: async () => ({ path: 'a.txt', mtimeMs: 2, size: 7 }),
      read: async () => ({ path: 'a.txt', content: 'changed', truncated: false, mtimeMs: 2, size: 7 }),
    })
    expect(await checkDiskState(params)).toBe('reloaded')
    expect(params.onReload).toHaveBeenCalledWith('changed')
    expect(params.onConflict).not.toHaveBeenCalled()
    expect(params.onRebaseline).toHaveBeenCalledWith({
      stat: { mtimeMs: 2, size: 7 },
      signature: getDiskBaselineSignature('changed'),
    })
  })

  it('raises a conflict and leaves the buffer alone when dirty', async () => {
    const params = makeParams({
      isDirty: true,
      stat: async () => ({ path: 'a.txt', mtimeMs: 2, size: 7 }),
      read: async () => ({ path: 'a.txt', content: 'changed', truncated: false, mtimeMs: 2, size: 7 }),
    })
    expect(await checkDiskState(params)).toBe('conflict')
    expect(params.onConflict).toHaveBeenCalledWith('changed')
    // The unsaved buffer must survive untouched — this is the data-loss guard.
    expect(params.onReload).not.toHaveBeenCalled()
    expect(params.onRebaseline).not.toHaveBeenCalled()
  })

  it('reports a deleted file', async () => {
    const params = makeParams({
      stat: async () => {
        throw Object.assign(new Error('not found'), { response: { status: 404 } })
      },
    })
    expect(await checkDiskState(params)).toBe('deleted')
    expect(params.onDeleted).toHaveBeenCalled()
  })

  it('stays quiet on a transient error that is not a 404', async () => {
    const params = makeParams({
      stat: async () => {
        throw Object.assign(new Error('offline'), { response: { status: 500 } })
      },
    })
    expect(await checkDiskState(params)).toBe('unavailable')
    expect(params.onDeleted).not.toHaveBeenCalled()
    expect(params.onConflict).not.toHaveBeenCalled()
  })
})
