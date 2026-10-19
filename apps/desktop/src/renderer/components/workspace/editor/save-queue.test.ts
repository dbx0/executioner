import { describe, expect, it, vi } from 'vitest'
import { createSaveQueue, type SaveQueueDeps } from './save-queue.js'
import { getDiskBaselineSignature } from './signature.js'
import type { DiskBaseline, ExternalMutation } from '../../../store/types.js'

/** A deferred promise, so a test can hold a write open and observe ordering. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

interface Harness {
  deps: SaveQueueDeps
  drafts: Record<string, string>
  baselines: Record<string, DiskBaseline>
  mutations: Record<string, ExternalMutation | null>
  dirty: Record<string, boolean>
}

function makeHarness(write: SaveQueueDeps['write']): Harness {
  const drafts: Record<string, string> = {}
  const baselines: Record<string, DiskBaseline> = {}
  const mutations: Record<string, ExternalMutation | null> = {}
  const dirty: Record<string, boolean> = {}
  const deps: SaveQueueDeps = {
    write,
    getDraft: (id) => drafts[id],
    clearDraft: (id) => {
      delete drafts[id]
    },
    setDirty: (id, value) => {
      dirty[id] = value
    },
    setDiskBaseline: (id, baseline) => {
      baselines[id] = baseline
    },
    getExternalMutation: (id) => mutations[id] ?? null,
    setExternalMutation: (id, mutation) => {
      mutations[id] = mutation
    },
  }
  return { deps, drafts, baselines, mutations, dirty }
}

const okWrite: SaveQueueDeps['write'] = async (path, content) => ({
  path,
  ok: true,
  mtimeMs: 1,
  size: content.length,
})

describe('createSaveQueue', () => {
  it('serializes two writes to the same file', async () => {
    const order: string[] = []
    const first = deferred<void>()
    const write = vi.fn<SaveQueueDeps['write']>(async (path, content) => {
      order.push(`start:${content}`)
      if (content === 'a') await first.promise
      order.push(`end:${content}`)
      return { path, ok: true, mtimeMs: 1, size: content.length }
    })
    const queue = createSaveQueue(makeHarness(write).deps)

    const saveA = queue.queueSave('f1', 'a.txt', 'a')
    const saveB = queue.queueSave('f1', 'a.txt', 'b')
    first.resolve()
    await Promise.all([saveA, saveB])

    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('rebaselines from the stat the write returned', async () => {
    const write = vi.fn<SaveQueueDeps['write']>(async (path, content) => ({
      path,
      ok: true,
      mtimeMs: 4242,
      size: content.length,
    }))
    const h = makeHarness(write)
    const queue = createSaveQueue(h.deps)

    await queue.queueSave('f1', 'a.txt', 'hello')

    expect(h.baselines.f1).toEqual({
      stat: { mtimeMs: 4242, size: 5 },
      signature: getDiskBaselineSignature('hello'),
    })
  })

  it('does not rebaseline when the generation was bumped mid-write', async () => {
    const gate = deferred<void>()
    const write = vi.fn<SaveQueueDeps['write']>(async (path, content) => {
      await gate.promise
      return { path, ok: true, mtimeMs: 1, size: content.length }
    })
    const h = makeHarness(write)
    const queue = createSaveQueue(h.deps)

    const save = queue.queueSave('f1', 'a.txt', 'hello')
    queue.bumpSaveGeneration('f1')
    gate.resolve()
    await save

    expect(h.baselines.f1).toBeUndefined()
  })

  it('keeps the tab dirty when the draft moved during the write', async () => {
    const h = makeHarness(async (path, content) => {
      // The user types while the write is in flight — after the queue has
      // snapshotted what it is writing.
      h.drafts.f1 = 'hello there'
      return { path, ok: true, mtimeMs: 1, size: content.length }
    })
    h.drafts.f1 = 'hello'
    const queue = createSaveQueue(h.deps)

    await queue.queueSave('f1', 'a.txt', 'hello')

    expect(h.dirty.f1).toBe(true)
    // The newer keystrokes survive: the save must not clear a moved buffer.
    expect(h.drafts.f1).toBe('hello there')
  })

  it('clears the draft and the dirty flag when the buffer did not move', async () => {
    const h = makeHarness(okWrite)
    h.drafts.f1 = 'hello'
    const queue = createSaveQueue(h.deps)

    await queue.queueSave('f1', 'a.txt', 'hello')

    expect(h.drafts.f1).toBeUndefined()
    expect(h.dirty.f1).toBe(false)
  })

  it('refuses an autosave while a conflict is unresolved but allows a user save', async () => {
    const write = vi.fn(okWrite)
    const h = makeHarness(write)
    h.mutations.f1 = 'changed'
    const queue = createSaveQueue(h.deps)

    await queue.queueSave('f1', 'a.txt', 'hello', 'autosave')
    expect(write).not.toHaveBeenCalled()

    await queue.queueSave('f1', 'a.txt', 'hello', 'user')
    expect(write).toHaveBeenCalledTimes(1)
    // The write made disk match the buffer, so the conflict is now stale.
    expect(h.mutations.f1).toBeNull()
  })

  it('reports a write as in flight only while it runs', async () => {
    let inFlightDuringWrite: boolean | null = null
    const h = makeHarness(async (path, content) => {
      inFlightDuringWrite = queue.isWriteInFlight('f1')
      return { path, ok: true, mtimeMs: 1, size: content.length }
    })
    // Referenced by the write above, which only runs after this is assigned.
    const queue = createSaveQueue(h.deps)

    expect(queue.isWriteInFlight('f1')).toBe(false)
    await queue.queueSave('f1', 'a.txt', 'hello')
    expect(inFlightDuringWrite).toBe(true)
    expect(queue.isWriteInFlight('f1')).toBe(false)
  })

  it('propagates a write failure without rebaselining', async () => {
    const write = vi.fn<SaveQueueDeps['write']>(async () => {
      throw new Error('disk full')
    })
    const h = makeHarness(write)
    const queue = createSaveQueue(h.deps)

    await expect(queue.queueSave('f1', 'a.txt', 'hello')).rejects.toThrow('disk full')
    expect(h.baselines.f1).toBeUndefined()
    expect(queue.isWriteInFlight('f1')).toBe(false)
  })
})
