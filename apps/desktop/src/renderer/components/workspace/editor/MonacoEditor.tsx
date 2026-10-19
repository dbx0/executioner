import type { JSX } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { monaco } from '../../../lib/monaco-setup.js'
import { useApp } from '../../../store.js'
import { monacoTheme } from '../../../lib/themes.js'
import { syncContentOnMount, syncContentUpdate } from './monaco-content-sync.js'
import { installViewStateTracking, restoreViewState, snapshotViewState } from './view-state-cache.js'
import { disposeClosedEditorTabs, registerEditorTabDisposer } from './tab-disposal.js'

// Hand the store a disposer now that Monaco is loaded here. Keeps the tabs
// slice free of any Monaco import (see registerEditorTabDisposer).
registerEditorTabDisposer((closed) => disposeClosedEditorTabs(monaco, closed))

export interface MonacoEditorProps {
  /** The file-tab id, used as the view-state cache key. */
  fileId: string
  filePath: string
  content: string
  language: string
  readOnly?: boolean
  onContentChange: (content: string) => void
  onSave: () => void
}

/**
 * The Monaco editing surface for one file.
 *
 * Only the pieces this app needs: no markdown annotations, gutter menu, auto-height, reveal
 * scheduler, decorations, or live tail.
 */
export function MonacoEditor({
  fileId,
  filePath,
  content,
  language,
  readOnly = false,
  onContentChange,
  onSave,
}: MonacoEditorProps): JSX.Element {
  const theme = useApp((s) => s.theme)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const scrollThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollSubRef = useRef<{ dispose: () => void } | null>(null)

  // The last value our own onChange emitted. Without this the content effect
  // below would push every keystroke back through the model.
  const lastEmittedRef = useRef<string | null>(null)
  // Assigned during render so the mount handler always reads the latest content
  // (a useEffect would leave a one-render stale window).
  const contentRef = useRef(content)
  contentRef.current = content
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return
      lastEmittedRef.current = value
      onContentChange(value)
    },
    [onContentChange],
  )

  const handleMount = useCallback<OnMount>(
    (editorInstance) => {
      editorRef.current = editorInstance
      // A retained model can hold text from before this remount; push the
      // current content in before anything else reads it.
      syncContentOnMount(editorInstance, contentRef.current)
      scrollSubRef.current = installViewStateTracking({
        editorInstance,
        viewStateKey: fileId,
        scrollThrottleTimerRef,
      }).scrollStateSub
      restoreViewState(editorInstance, fileId)
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current()
      })
    },
    [fileId],
  )

  // External content changes, for a tab that stayed mounted.
  useEffect(() => {
    const editorInstance = editorRef.current
    if (editorInstance === null) return
    if (content === lastEmittedRef.current) return
    syncContentUpdate(editorInstance, content)
  }, [content])

  // useLayoutEffect: this cleanup runs before @monaco-editor/react disposes the
  // editor, so getScrollTop() still reads valid state on unmount.
  useLayoutEffect(() => {
    return () => {
      // Cancel the pending throttled write so it cannot fire after this
      // snapshot and overwrite the final position with a stale value.
      if (scrollThrottleTimerRef.current !== null) {
        clearTimeout(scrollThrottleTimerRef.current)
        scrollThrottleTimerRef.current = null
      }
      snapshotViewState(editorRef, fileId)
      scrollSubRef.current?.dispose()
      scrollSubRef.current = null
    }
  }, [fileId])

  return (
    <Editor
      height="100%"
      language={language}
      // defaultValue, not a controlled value — we own post-mount content sync,
      // and a controlled path would double-setValue.
      defaultValue={content}
      theme={monacoTheme(theme)}
      onChange={handleChange}
      onMount={handleMount}
      path={filePath}
      // We own cursor/scroll restoration, so disable the competing view-state map.
      saveViewState={false}
      keepCurrentModel
      options={{
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        fontSize: 12.5,
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        automaticLayout: true,
        tabSize: 2,
        readOnly,
        smoothScrolling: true,
        padding: { top: 0 },
      }}
    />
  )
}
