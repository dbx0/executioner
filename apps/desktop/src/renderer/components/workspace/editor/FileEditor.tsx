import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { filesApi, type FileContent } from '../../../api/files.js'
import type { AxiosInstance } from 'axios'
import type { DiskBaseline } from '../../../store/types.js'
import { friendlyError } from '../../../lib/api-error.js'
import { ScrollArea } from '../../ui/scroll-area.js'
import { useApp, type FileTab } from '../../../store.js'
import { detectLanguage } from './language-detect.js'
import { isEditorContentUnchanged } from './dirty-state.js'
import { getDiskBaselineSignature } from './signature.js'
import { saveQueue } from './save-queue-instance.js'
import { MarkdownRender } from '../../markdown/MarkdownRender.js'
import { MonacoEditor } from './MonacoEditor.js'
import { isMarkdownPath } from '../file-kind.js'
import { useDiskWatch } from './useDiskWatch.js'
import { ExternalFileChangeBanner } from './ExternalFileChangeBanner.js'
import { EditorHeader, type MarkdownView, type SaveState } from './EditorHeader.js'
import { Button } from '../../ui/button.js'
import { scheduleAutosave, DEFAULT_AUTO_SAVE_DELAY_MS } from './autosave.js'

/**
 * The editable surface for one loaded, non-binary text file.
 *
 * The buffer lives in the store (`editorDrafts`), not component state, so it
 * survives this component unmounting — a tab switch, the preview slot being
 * reused, or a restart. Saving goes through the shared save queue, which
 * serializes writes per file so two rapid ⌘S presses cannot race.
 */
export function FileEditor({
  client,
  file,
  initial,
  isVisible = true,
}: {
  client: AxiosInstance
  file: FileTab
  initial: FileContent
  isVisible?: boolean
}): JSX.Element {
  const draft = useApp((s) => s.editorDrafts[file.id])
  const setEditorDraft = useApp((s) => s.setEditorDraft)
  const clearEditorDraft = useApp((s) => s.clearEditorDraft)
  const setDiskBaseline = useApp((s) => s.setDiskBaseline)
  const baseline = useApp((s) => s.diskBaselines[file.id])
  const externalMutation = useApp((s) => s.externalMutation[file.id]) ?? null
  const setExternalMutation = useApp((s) => s.setExternalMutation)
  const setFileDirty = useApp((s) => s.setFileDirty)
  const promoteFileTab = useApp((s) => s.promoteFileTab)
  const editorAutoSave = useApp((s) => s.editorAutoSave)

  const isMarkdown = isMarkdownPath(file.path)
  // Truncated files were sliced to their tail on read — editing and saving
  // would destroy the head, so they stay read-only.
  const readOnly = initial.truncated

  // The content most recently known to be on disk. A reload replaces it.
  const loadedContentRef = useRef(initial.content)
  const value = draft ?? loadedContentRef.current

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  // Markdown opens rendered: reading is the common case, and the Editor/Split
  // toggles are one click away when you actually want to edit.
  const [mdView, setMdView] = useState<MarkdownView>('preview')

  const dirty = !isEditorContentUnchanged(value, loadedContentRef.current, isMarkdown)

  // Establish the disk baseline once per loaded file, so change detection has
  // something to compare against.
  useEffect(() => {
    setDiskBaseline(file.id, {
      stat: { mtimeMs: initial.mtimeMs, size: initial.size },
      signature: getDiskBaselineSignature(initial.content),
    })
  }, [file.id, initial.mtimeMs, initial.size, initial.content, setDiskBaseline])

  const handleContentChange = useCallback(
    (content: string) => {
      setEditorDraft(file.id, content)
    },
    [file.id, setEditorDraft],
  )

  // Mirror dirty state to the store (drives the tab dot) and promote a preview
  // tab on the first edit.
  useEffect(() => {
    setFileDirty(file.id, dirty)
    if (dirty) promoteFileTab(file.id)
  }, [dirty, file.id, setFileDirty, promoteFileTab])

  const save = useCallback(async () => {
    if (readOnly) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveQueue.queueSave(file.id, file.path, value)
      loadedContentRef.current = useApp.getState().editorDrafts[file.id] ?? value
      setJustSaved(true)
    } catch (e) {
      setSaveError(friendlyError(e, 'Couldn’t save this file.'))
    } finally {
      setSaving(false)
    }
  }, [file.id, file.path, value, readOnly])

  // Autosave, when enabled. Suspended while a conflict is unresolved — the
  // queue enforces that too, but not scheduling avoids pointless wakeups.
  useEffect(() => {
    return scheduleAutosave({
      enabled: editorAutoSave && !readOnly,
      dirty,
      suspended: externalMutation === 'changed',
      delayMs: DEFAULT_AUTO_SAVE_DELAY_MS,
      save: () => {
        void saveQueue.queueSave(file.id, file.path, value, 'autosave')
      },
    })
  }, [editorAutoSave, readOnly, dirty, externalMutation, file.id, file.path, value])

  // A freshly-saved badge fades after a moment; any new edit clears it too.
  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), 1500)
    return () => clearTimeout(t)
  }, [justSaved])
  useEffect(() => {
    if (dirty) setJustSaved(false)
  }, [dirty])

  // What disk held at the last check, so Compare can show it and Reload can
  // apply it without a second fetch.
  const [diskContent, setDiskContent] = useState<string | null>(null)
  const [undoableReload, setUndoableReload] = useState<
    { draft: string; baseline: DiskBaseline } | null
  >(null)
  const [comparing, setComparing] = useState(false)

  const adoptDiskContent = useCallback(
    (content: string) => {
      loadedContentRef.current = content
      clearEditorDraft(file.id)
      setFileDirty(file.id, false)
    },
    [file.id, clearEditorDraft, setFileDirty],
  )

  useDiskWatch({
    enabled: isVisible && !readOnly,
    path: file.path,
    isDirty: dirty,
    baseline,
    isWriteInFlight: () => saveQueue.isWriteInFlight(file.id),
    stat: (path) => filesApi(client).stat(path),
    read: (path) => filesApi(client).read(path),
    onReload: adoptDiskContent,
    onConflict: (content) => {
      // Never touch the buffer here — the unsaved work is the thing being
      // protected. Only record what disk holds so the user can compare.
      setDiskContent(content)
      setExternalMutation(file.id, 'changed')
    },
    onDeleted: () => setExternalMutation(file.id, 'deleted'),
    onRebaseline: (next) => setDiskBaseline(file.id, next),
  })

  const handleReloadFromDisk = useCallback(() => {
    if (diskContent === null) return
    const discardedDraft = useApp.getState().editorDrafts[file.id]
    const discardedBaseline = useApp.getState().diskBaselines[file.id]
    adoptDiskContent(diskContent)
    setDiskBaseline(file.id, {
      stat: { mtimeMs: Date.now(), size: diskContent.length },
      signature: getDiskBaselineSignature(diskContent),
    })
    setExternalMutation(file.id, null)
    // A mistaken click would otherwise be an unrecoverable discard, so keep the
    // draft recoverable for a short while.
    if (discardedDraft !== undefined && discardedBaseline !== undefined) {
      setUndoableReload({ draft: discardedDraft, baseline: discardedBaseline })
    }
  }, [diskContent, file.id, adoptDiskContent, setDiskBaseline, setExternalMutation])

  const handleUndoReload = useCallback(() => {
    if (undoableReload === null) return
    // If the user has typed since the reload, that newer work wins — undoing
    // over it would be a second silent discard.
    if (useApp.getState().editorDrafts[file.id] !== undefined) {
      setUndoableReload(null)
      return
    }
    setEditorDraft(file.id, undoableReload.draft)
    setFileDirty(file.id, true)
    // The conflict (and its autosave suspension) comes back with the draft.
    setDiskBaseline(file.id, undoableReload.baseline)
    setExternalMutation(file.id, 'changed')
    setUndoableReload(null)
  }, [undoableReload, file.id, setEditorDraft, setFileDirty, setDiskBaseline, setExternalMutation])

  const handleKeepEdits = useCallback(() => {
    setExternalMutation(file.id, null)
    // Advance the baseline to what disk now holds, so a dismissed conflict does
    // not re-derive itself on the next check or after a restart.
    if (diskContent !== null) {
      setDiskBaseline(file.id, {
        stat: { mtimeMs: Date.now(), size: diskContent.length },
        signature: getDiskBaselineSignature(diskContent),
      })
    }
  }, [file.id, diskContent, setExternalMutation, setDiskBaseline])

  // The undo offer is short-lived; it lapses rather than lingering forever.
  useEffect(() => {
    if (undoableReload === null) return
    const t = setTimeout(() => setUndoableReload(null), 8000)
    return () => clearTimeout(t)
  }, [undoableReload])

  const language = detectLanguage(file.path)
  const saveState: SaveState = readOnly
    ? { kind: 'read-only' }
    : saveError !== null
      ? { kind: 'error', message: saveError }
      : saving
        ? { kind: 'saving' }
        : dirty
          ? { kind: 'dirty' }
          : justSaved
            ? { kind: 'saved' }
            : { kind: 'clean' }

  const editor = (
    <MonacoEditor
      fileId={file.id}
      filePath={file.path}
      content={value}
      language={language}
      readOnly={readOnly}
      onContentChange={handleContentChange}
      onSave={() => void save()}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorHeader
        path={file.path}
        language={language}
        save={saveState}
        markdownView={isMarkdown ? mdView : undefined}
        onMarkdownView={setMdView}
      />

      <ExternalFileChangeBanner
        mutation={externalMutation}
        {...(undoableReload !== null ? { undoReload: handleUndoReload } : {})}
        onReload={handleReloadFromDisk}
        onKeepEdits={handleKeepEdits}
        onCompare={() => setComparing((v) => !v)}
      />

      {comparing && diskContent !== null && (
        <div className="flex h-[40%] min-h-0 shrink-0 flex-col border-b border-glass-border">
          <div className="flex h-8 shrink-0 items-center justify-between pl-3 pr-1.5 text-[11px] text-muted-foreground">
            <span>On disk (read-only)</span>
            <Button variant="ghost" size="xs" onClick={() => setComparing(false)}>
              Close
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <MonacoEditor
              fileId={`${file.id}:disk`}
              filePath={`${file.path}.disk`}
              content={diskContent}
              language={language}
              readOnly
              onContentChange={() => {}}
              onSave={() => {}}
            />
          </div>
        </div>
      )}

      {initial.truncated && (
        <div className="shrink-0 border-b border-glass-border px-3 py-1 text-[11px] text-muted-foreground">
          Showing the last {Math.round(initial.content.length / 1000)} KB. This file was truncated.
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {isMarkdown && mdView === 'preview' ? (
          <ScrollArea className="h-full min-h-0">
            <MarkdownRender source={value} />
          </ScrollArea>
        ) : isMarkdown && mdView === 'split' ? (
          <div className="grid h-full min-h-0 grid-cols-2 divide-x divide-glass-border">
            <div className="min-h-0 overflow-hidden">{editor}</div>
            <ScrollArea className="min-h-0">
              <MarkdownRender source={value} />
            </ScrollArea>
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-hidden">{editor}</div>
        )}
      </div>
    </div>
  )
}
