// There is no read-only live-tail mode: we have no live-tail surface, so every
// sync is undoable.
import type { editor } from 'monaco-editor'

function normalizeToModelEol(content: string, model: editor.ITextModel): string {
  const eol = model.getEOL()
  // Monaco normalizes model line endings while filesystem content keeps its raw
  // EOLs. Compare the representation Monaco can actually retain.
  if (eol === '\n' && !content.includes('\r')) {
    return content
  }
  return content.replace(/\r\n|\r|\n/g, eol)
}

function applyModelEdit(
  editorInstance: editor.IStandaloneCodeEditor,
  model: editor.ITextModel,
  edit: editor.IIdentifiedSingleEditOperation,
  withUndoStops: boolean,
): void {
  if (withUndoStops) {
    editorInstance.pushUndoStop()
  }
  model.pushEditOperations([], [edit], () => null)
  if (withUndoStops) {
    editorInstance.pushUndoStop()
  }
}

function replaceModelContent(
  editorInstance: editor.IStandaloneCodeEditor,
  model: editor.ITextModel,
  currentContent: string,
  content: string,
  withUndoStops: boolean,
): void {
  if (currentContent === content) {
    return
  }
  const fullRange = model.getFullModelRange()
  applyModelEdit(editorInstance, model, { range: fullRange, text: content }, withUndoStops)
}

/**
 * Reconcile a freshly-mounted editor's retained model against the current
 * `content`. Called from the mount handler.
 *
 * Why: `keepCurrentModel` retains Monaco models across unmounts so undo/redo
 * survives tab switches. But @monaco-editor/react skips its value→model sync on
 * the first render after a remount and reuses the retained model — so external
 * changes that arrived while the tab was unmounted stay invisible until we push
 * them into the model here.
 */
export function syncContentOnMount(
  editorInstance: editor.IStandaloneCodeEditor,
  content: string,
): boolean {
  const model = editorInstance.getModel()
  if (!model) {
    return false
  }
  const currentContent = model.getValue()
  const normalizedContent = normalizeToModelEol(content, model)
  if (currentContent === normalizedContent) {
    return false
  }
  // No undo stop on mount — the retained model's text was already the user's
  // last-known state, and an undo entry here would make Ctrl+Z revert to the
  // pre-remount text, which is baffling from the user's side.
  replaceModelContent(editorInstance, model, currentContent, normalizedContent, false)
  return true
}

/**
 * Push a prop-driven content change into the live model, for external changes
 * that arrive while the editor stays mounted.
 *
 * The caller short-circuits content it emitted itself before calling this.
 */
export function syncContentUpdate(
  editorInstance: editor.IStandaloneCodeEditor,
  content: string,
): void {
  const model = editorInstance.getModel()
  if (!model) {
    return
  }
  const currentContent = model.getValue()
  const normalizedContent = normalizeToModelEol(content, model)
  if (currentContent.length === normalizedContent.length) {
    replaceModelContent(editorInstance, model, currentContent, normalizedContent, true)
    return
  }
  if (
    normalizedContent.length > currentContent.length &&
    normalizedContent.startsWith(currentContent)
  ) {
    // Preserving the existing prefix lets Monaco retain viewport, selection,
    // find-widget and tokenization state above a live append.
    const fullRange = model.getFullModelRange()
    applyModelEdit(
      editorInstance,
      model,
      {
        range: {
          startLineNumber: fullRange.endLineNumber,
          startColumn: fullRange.endColumn,
          endLineNumber: fullRange.endLineNumber,
          endColumn: fullRange.endColumn,
        },
        text: normalizedContent.slice(currentContent.length),
      },
      true,
    )
    return
  }
  replaceModelContent(editorInstance, model, currentContent, normalizedContent, true)
}
