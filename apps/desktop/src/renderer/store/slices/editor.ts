import type { AppState, DiskBaseline, ExternalMutation } from '../types.js'
import type { SliceCtx } from './context.js'

/** The three editor-state maps an engagement carries, as a reusable shape. */
type EditorStateMaps = {
  editorDrafts: Record<string, string>
  diskBaselines: Record<string, DiskBaseline>
  externalMutation: Record<string, ExternalMutation>
}

/**
 * Unsaved buffers, disk baselines, and conflict marks for open file tabs.
 *
 * These live on the engagement (and are mirrored) rather than inside the editor
 * component so a buffer survives the component unmounting — switching tabs,
 * reusing the preview slot, or closing and reopening the app.
 */
export function createEditorSlice(
  ctx: SliceCtx,
): Pick<
  AppState,
  | 'setEditorDraft'
  | 'clearEditorDraft'
  | 'setDiskBaseline'
  | 'clearDiskBaseline'
  | 'setExternalMutation'
> {
  const { get, patchActive, persistEditorState } = ctx

  return {
    setEditorDraft: (id, content) => {
      patchActive((e) => ({ ...e, editorDrafts: { ...e.editorDrafts, [id]: content } }))
      persistEditorState(get().activeRoot)
    },

    clearEditorDraft: (id) => {
      patchActive((e) => {
        if (!(id in e.editorDrafts)) return e
        const { [id]: _dropped, ...editorDrafts } = e.editorDrafts
        return { ...e, editorDrafts }
      })
      persistEditorState(get().activeRoot)
    },

    setDiskBaseline: (id, baseline) => {
      patchActive((e) => ({ ...e, diskBaselines: { ...e.diskBaselines, [id]: baseline } }))
      persistEditorState(get().activeRoot)
    },

    clearDiskBaseline: (id) => {
      patchActive((e) => {
        if (!(id in e.diskBaselines)) return e
        const { [id]: _dropped, ...diskBaselines } = e.diskBaselines
        return { ...e, diskBaselines }
      })
      persistEditorState(get().activeRoot)
    },

    setExternalMutation: (id, mutation) => {
      patchActive((e) => {
        if (mutation === null) {
          if (!(id in e.externalMutation)) return e
          const { [id]: _dropped, ...externalMutation } = e.externalMutation
          return { ...e, externalMutation }
        }
        return { ...e, externalMutation: { ...e.externalMutation, [id]: mutation } }
      })
    },
  }
}

/** Drop every editor-state entry owned by a closed tab. */
export function withoutEditorStateFor(engagement: EditorStateMaps, id: string): EditorStateMaps {
  const { [id]: _draft, ...editorDrafts } = engagement.editorDrafts
  const { [id]: _baseline, ...diskBaselines } = engagement.diskBaselines
  const { [id]: _mutation, ...externalMutation } = engagement.externalMutation
  return { editorDrafts, diskBaselines, externalMutation }
}
