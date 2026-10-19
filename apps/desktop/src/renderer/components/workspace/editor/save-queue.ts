// No runtime-owner/SSH plumbing, no window event bus, and no
// TTL-stamped self-write registry — our write response carries the resulting
// stat, so we rebaseline exactly instead of guessing an echo window.
import type { FileWriteResult } from '../../../api/files.js'
import type { DiskBaseline, ExternalMutation } from '../../../store/types.js'
import { getDiskBaselineSignature } from './signature.js'

export type SaveTrigger = 'user' | 'autosave'

export interface SaveQueueDeps {
  write: (path: string, content: string) => Promise<FileWriteResult>
  getDraft: (fileId: string) => string | undefined
  clearDraft: (fileId: string) => void
  setDirty: (fileId: string, dirty: boolean) => void
  setDiskBaseline: (fileId: string, baseline: DiskBaseline) => void
  getExternalMutation: (fileId: string) => ExternalMutation | null
  setExternalMutation: (fileId: string, mutation: ExternalMutation | null) => void
}

export interface SaveQueue {
  queueSave: (fileId: string, path: string, content: string, trigger?: SaveTrigger) => Promise<void>
  bumpSaveGeneration: (fileId: string) => void
  isWriteInFlight: (fileId: string) => boolean
  dispose: () => void
}

/**
 * Serializes writes per file id.
 *
 * Two guarantees matter here, and both exist because getting them wrong loses
 * user work:
 *
 * 1. Writes to one path never overlap. Each save chains off the previous save's
 *    promise, so two rapid Ctrl+S presses cannot interleave and let the
 *    later-resolving one rebaseline last regardless of what reached disk.
 * 2. A stale write never rebaselines. The generation is checked twice — before
 *    the write and again after it resolves — because an external-change reload
 *    can land in between, and rebaselining afterwards would mark the tab clean
 *    against content that is no longer on disk.
 */
export function createSaveQueue(deps: SaveQueueDeps): SaveQueue {
  const saveQueue = new Map<string, Promise<void>>()
  const saveGeneration = new Map<string, number>()
  const inFlight = new Set<string>()

  const bumpSaveGeneration = (fileId: string): void => {
    saveGeneration.set(fileId, (saveGeneration.get(fileId) ?? 0) + 1)
  }

  const queueSave = (
    fileId: string,
    path: string,
    content: string,
    trigger: SaveTrigger = 'user',
  ): Promise<void> => {
    const queuedGeneration = saveGeneration.get(fileId) ?? 0
    const previousSave = saveQueue.get(fileId) ?? Promise.resolve()

    const queuedSave = previousSave
      .catch(() => undefined)
      .then(async () => {
        if ((saveGeneration.get(fileId) ?? 0) !== queuedGeneration) {
          return
        }
        // Autosave must never resolve a conflict by overwriting the newer
        // external content. An explicit save proceeds — the banner warned.
        if (trigger === 'autosave' && deps.getExternalMutation(fileId) === 'changed') {
          return
        }

        const contentToSave = deps.getDraft(fileId) ?? content
        inFlight.add(fileId)
        let result: FileWriteResult
        try {
          result = await deps.write(path, contentToSave)
        } finally {
          inFlight.delete(fileId)
        }

        if ((saveGeneration.get(fileId) ?? 0) !== queuedGeneration) {
          return
        }

        // The buffer may have moved while the write was in flight; only the
        // untouched case is genuinely clean.
        const currentDraft = deps.getDraft(fileId)
        const stillDirty = currentDraft !== undefined && currentDraft !== contentToSave
        deps.setDirty(fileId, stillDirty)
        if (!stillDirty) {
          deps.clearDraft(fileId)
        }

        deps.setDiskBaseline(fileId, {
          stat: { mtimeMs: result.mtimeMs, size: result.size },
          signature: getDiskBaselineSignature(contentToSave),
        })

        // Disk now holds what we just wrote, so any conflict mark is stale.
        if (deps.getExternalMutation(fileId) === 'changed') {
          deps.setExternalMutation(fileId, null)
        }
      })

    const trackedSave: Promise<void> = queuedSave.finally(() => {
      if (saveQueue.get(fileId) === trackedSave) {
        saveQueue.delete(fileId)
      }
    })
    saveQueue.set(fileId, trackedSave)
    return trackedSave
  }

  return {
    queueSave,
    bumpSaveGeneration,
    isWriteInFlight: (fileId) => inFlight.has(fileId),
    dispose: () => {
      saveQueue.clear()
      saveGeneration.clear()
      inFlight.clear()
    },
  }
}
