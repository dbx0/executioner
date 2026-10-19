import { filesApi } from '../../../api/files.js'
import { useApp } from '../../../store.js'
import { createSaveQueue, type SaveQueue } from './save-queue.js'

/**
 * The one save queue for the whole renderer.
 *
 * A single instance is correct — and necessary — because the queue keys every
 * map by file-tab id, and those ids are unique across engagements (see
 * `nextFileId` in store/helpers). A per-component instance would defeat the
 * serialization the queue exists to provide: two mounts of the same file would
 * each hold their own chain and could interleave writes.
 */
export const saveQueue: SaveQueue = createSaveQueue({
  write: async (path, content) => {
    // Read the client at call time: it changes when the active engagement does.
    const client = useApp.getState().client
    if (client === null) {
      throw new Error('No engagement is connected, so this file cannot be saved.')
    }
    return filesApi(client).write(path, content)
  },
  getDraft: (fileId) => useApp.getState().editorDrafts[fileId],
  clearDraft: (fileId) => useApp.getState().clearEditorDraft(fileId),
  setDirty: (fileId, dirty) => useApp.getState().setFileDirty(fileId, dirty),
  setDiskBaseline: (fileId, baseline) => useApp.getState().setDiskBaseline(fileId, baseline),
  getExternalMutation: (fileId) => useApp.getState().externalMutation[fileId] ?? null,
  setExternalMutation: (fileId, mutation) => useApp.getState().setExternalMutation(fileId, mutation),
})
