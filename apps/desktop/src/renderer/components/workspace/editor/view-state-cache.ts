// No PDF or diff view-state caches (those belong to later
// sub-projects), and no cursor-line tracking (no "copy path to line" feature).
import type { MutableRefObject } from 'react'
import type { editor, ISelection } from 'monaco-editor'

// 20 entries covers a typical working set of open files. Eviction only costs a
// scroll position (the user sees the top of the file), never correctness, so a
// conservative cap is fine.
const CACHE_MAX_ENTRIES = 20

/**
 * Set a key, evicting the oldest entry once the map exceeds `maxEntries`.
 *
 * Module-scoped Maps would otherwise grow unboundedly as unique file keys
 * accumulate. Maps iterate in insertion order, so deleting before setting
 * refreshes recency.
 */
export function setWithLRU<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number = CACHE_MAX_ENTRIES,
): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > maxEntries) {
    // Use the iterator's `.done`, not an `undefined` check on the value: K can
    // legitimately be `undefined`, and that check would skip valid evictions.
    const first = map.keys().next()
    if (!first.done) {
      map.delete(first.value)
    }
  }
}

// Module-scoped rather than in Zustand: these are written on every scroll and
// selection change, and a store write would broadcast a re-render to every
// subscriber even though nothing renders from a scroll position.
export const scrollTopCache = new Map<string, number>()
export const editorSelectionCache = new Map<string, readonly ISelection[]>()

/** Drop every cached view-state entry for one key. */
export function clearViewState(viewStateKey: string): void {
  scrollTopCache.delete(viewStateKey)
  editorSelectionCache.delete(viewStateKey)
}

type ViewStateTrackingParams = {
  editorInstance: editor.IStandaloneCodeEditor
  viewStateKey: string
  scrollThrottleTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
}

/** Subscribe to scroll changes so the resting position can be restored later. */
export function installViewStateTracking(params: ViewStateTrackingParams): {
  scrollStateSub: { dispose: () => void }
} {
  const { editorInstance, viewStateKey, scrollThrottleTimerRef } = params

  // Only the resting scroll position matters, so write on a trailing throttle
  // (~150ms) rather than on every 60fps frame.
  const scrollStateSub = editorInstance.onDidScrollChange((e) => {
    if (scrollThrottleTimerRef.current !== null) {
      clearTimeout(scrollThrottleTimerRef.current)
    }
    scrollThrottleTimerRef.current = setTimeout(() => {
      setWithLRU(scrollTopCache, viewStateKey, e.scrollTop)
      scrollThrottleTimerRef.current = null
    }, 150)
  })

  return { scrollStateSub }
}

export function restoreViewState(
  editorInstance: editor.IStandaloneCodeEditor,
  viewStateKey: string,
): void {
  const savedSelections = editorSelectionCache.get(viewStateKey)
  const savedScrollTop = scrollTopCache.get(viewStateKey)
  if (savedScrollTop !== undefined || savedSelections) {
    // Monaco renders synchronously so one frame suffices; focusing inside it
    // avoids a scroll-0 flash before the restore lands.
    requestAnimationFrame(() => {
      if (savedSelections) {
        editorInstance.setSelections(savedSelections)
      }
      if (savedScrollTop !== undefined) {
        editorInstance.setScrollTop(savedScrollTop)
      }
      editorInstance.focus()
    })
  } else {
    editorInstance.focus()
  }
}

// Takes the ref, not the instance: the caller runs this from an effect cleanup,
// where reading `.current` inline trips the ref-in-cleanup lint.
export function snapshotViewState(
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  viewStateKey: string,
): void {
  const ed = editorRef.current
  if (ed) {
    setWithLRU(scrollTopCache, viewStateKey, ed.getScrollTop())
    const selections = ed.getSelections()
    if (selections) {
      setWithLRU(editorSelectionCache, viewStateKey, selections)
    }
  }
}
