import { describe, expect, it } from 'vitest'
import type { editor } from 'monaco-editor'
import { syncContentOnMount, syncContentUpdate } from './monaco-content-sync.js'

interface Applied {
  range: unknown
  text: string
}

interface Harness {
  instance: editor.IStandaloneCodeEditor
  applied: Applied[]
  undoStops: () => number
  value: () => string
}

/**
 * A fake Monaco editor + model. Driving fakes keeps these tests fast and lets
 * them assert the edit operations we issue, which is the actual contract.
 */
function makeEditor(initial: string, eol: '\n' | '\r\n' = '\n'): Harness {
  let value = initial
  const applied: Applied[] = []
  let undoStops = 0

  const model = {
    getValue: () => value,
    getEOL: () => eol,
    getFullModelRange: () => {
      const lines = value.split(eol)
      return {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: lines.length,
        endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
      }
    },
    pushEditOperations: (_selections: unknown, edits: Applied[]) => {
      applied.push(...edits)
      for (const edit of edits) value = applyEdit(value, edit)
      return null
    },
    applyEdits: (edits: Applied[]) => {
      applied.push(...edits)
      for (const edit of edits) value = applyEdit(value, edit)
    },
  }

  /** Full-range edits replace; a zero-width range at the end appends. */
  function applyEdit(current: string, edit: Applied): string {
    const range = edit.range as { startLineNumber: number; startColumn: number }
    const isAppendAtEnd = range.startLineNumber > 1 || range.startColumn > 1
    return isAppendAtEnd ? current + edit.text : edit.text
  }

  const instance = {
    getModel: () => model,
    pushUndoStop: () => {
      undoStops += 1
    },
  } as unknown as editor.IStandaloneCodeEditor

  return { instance, applied, undoStops: () => undoStops, value: () => value }
}

describe('syncContentOnMount', () => {
  it('is a no-op when the retained model already matches', () => {
    const h = makeEditor('hello')
    expect(syncContentOnMount(h.instance, 'hello')).toBe(false)
    expect(h.applied).toHaveLength(0)
  })

  it('pushes content that changed while the tab was unmounted', () => {
    const h = makeEditor('hello')
    expect(syncContentOnMount(h.instance, 'goodbye')).toBe(true)
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0]?.text).toBe('goodbye')
  })

  it('normalizes line endings to the model EOL before comparing', () => {
    const h = makeEditor('a\r\nb', '\r\n')
    expect(syncContentOnMount(h.instance, 'a\nb')).toBe(false)
    expect(h.applied).toHaveLength(0)
  })

  it('adds no undo stop on mount, so Ctrl+Z cannot revert past the remount', () => {
    const h = makeEditor('hello')
    syncContentOnMount(h.instance, 'goodbye')
    expect(h.undoStops()).toBe(0)
  })
})

describe('syncContentUpdate', () => {
  it('appends only the suffix when the new content extends the old', () => {
    const h = makeEditor('line one\n')
    syncContentUpdate(h.instance, 'line one\nline two\n')
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0]?.text).toBe('line two\n')
  })

  it('replaces the whole model when the change is not an append', () => {
    const h = makeEditor('line one\nline two\n')
    syncContentUpdate(h.instance, 'different\n')
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0]?.text).toBe('different\n')
  })

  it('does nothing when the content is unchanged', () => {
    const h = makeEditor('same')
    syncContentUpdate(h.instance, 'same')
    expect(h.applied).toHaveLength(0)
  })

  it('brackets a live update with undo stops', () => {
    const h = makeEditor('a')
    syncContentUpdate(h.instance, 'b')
    expect(h.undoStops()).toBe(2)
  })
})
