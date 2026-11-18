import type { JSX } from 'react'
import { Check, Columns2, Eye, PenLine } from 'lucide-react'
import { Segmented, type SegmentedOption } from '../../ui/segmented.js'
import { Spinner } from '../../ui/spinner.js'

/** How markdown is laid out: source-only, side-by-side, or rendered-only. */
export type MarkdownView = 'source' | 'split' | 'preview'

/** The keyboard-shortcut modifier glyph for the current platform. */
const MOD = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform) ? '⌘' : 'Ctrl'

const MARKDOWN_VIEWS: readonly SegmentedOption<MarkdownView>[] = [
  { value: 'source', ariaLabel: 'Editor', label: <PenLine className="size-3.5" strokeWidth={1.75} /> },
  { value: 'split', ariaLabel: 'Split', label: <Columns2 className="size-3.5" strokeWidth={1.75} /> },
  { value: 'preview', ariaLabel: 'Preview', label: <Eye className="size-3.5" strokeWidth={1.75} /> },
]

/** Where the buffer stands against disk, in the order the states take precedence. */
export type SaveState =
  | { kind: 'read-only' }
  | { kind: 'error'; message: string }
  | { kind: 'saving' }
  | { kind: 'dirty' }
  | { kind: 'saved' }
  | { kind: 'clean' }

function SaveStatus({ state }: { state: SaveState }): JSX.Element {
  switch (state.kind) {
    case 'read-only':
      return <span>Read-only: this file was truncated on load.</span>
    case 'error':
      return (
        <span role="alert" className="truncate text-status-error">
          {state.message}
        </span>
      )
    case 'saving':
      return (
        <span role="status" className="flex items-center gap-1.5">
          <Spinner size="xs" /> Saving
        </span>
      )
    case 'dirty':
      return (
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden /> Unsaved
          <kbd className="rounded-control border border-glass-border px-1.5 text-[10px]">{MOD}S</kbd>
        </span>
      )
    case 'saved':
      return (
        <span className="flex items-center gap-1">
          <Check className="size-3 text-status-success" /> Saved
        </span>
      )
    case 'clean':
      return <span>{MOD}S to save</span>
  }
}

/**
 * The thin row over an editor: the file's path, where the buffer stands against
 * disk, and its language. A markdown file also gets its layout switch here.
 */
export function EditorHeader({
  path,
  language,
  save,
  markdownView,
  onMarkdownView,
}: {
  path: string
  language: string
  save: SaveState
  /** The markdown layout, for a markdown file; leave out for anything else. */
  markdownView?: MarkdownView | undefined
  onMarkdownView?: ((view: MarkdownView) => void) | undefined
}): JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2.5 border-b border-glass-border px-3 text-[11px] text-muted-foreground">
      {markdownView !== undefined && onMarkdownView !== undefined && (
        <Segmented size="sm" label="Markdown view" options={MARKDOWN_VIEWS} value={markdownView} onChange={onMarkdownView} />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{path}</span>
      <div className="flex min-w-0 shrink items-center gap-2.5">
        <SaveStatus state={save} />
        <span className="shrink-0 text-tertiary-foreground">{language}</span>
      </div>
    </div>
  )
}
