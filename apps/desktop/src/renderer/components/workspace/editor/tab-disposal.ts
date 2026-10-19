// Only 'edit' tabs exist here — no diff, preview, or PDF surfaces.
import { clearViewState } from './view-state-cache.js'

/**
 * The slice of the monaco namespace this needs. Taken as an argument rather
 * than imported so the sweep stays testable without loading monaco-editor.
 */
export type MonacoModelRegistry = {
  editor: { getModel(uri: unknown): { dispose(): void } | null }
  Uri: { parse(value: string): unknown }
}

/**
 * Releases the Monaco models and view-state entries owned by closed tabs.
 *
 * Necessary because `keepCurrentModel` means nothing else ever disposes a
 * model — without this they accumulate for the lifetime of the process.
 *
 * Takes a batch: each cache sweep is a full scan, so disposing one tab at a
 * time would make "close all" quadratic in retained models.
 */
export function disposeClosedEditorTabs(
  registry: MonacoModelRegistry,
  closed: readonly { id: string; path: string }[],
): void {
  if (closed.length === 0) {
    return
  }
  for (const tab of closed) {
    // The model URI is built with Uri.parse(path) to match the `path` prop
    // convention @monaco-editor/react uses.
    registry.editor.getModel(registry.Uri.parse(tab.path))?.dispose()
    clearViewState(tab.id)
  }
}

type EditorTabDisposer = (closed: readonly { id: string; path: string }[]) => void

let activeDisposer: EditorTabDisposer | null = null

/**
 * Lets the editor layer hand the store a disposer without the store importing
 * Monaco. A static `import { monaco }` in the tabs slice would pull the whole
 * editor — several megabytes, plus its DOM probes — into every module that
 * touches the store, including tests that never open a file.
 */
export function registerEditorTabDisposer(disposer: EditorTabDisposer): void {
  activeDisposer = disposer
}

/** Dispose through whatever the editor layer registered; a no-op if nothing has. */
export function disposeClosedEditorTabsIfRegistered(
  closed: readonly { id: string; path: string }[],
): void {
  activeDisposer?.(closed)
}
