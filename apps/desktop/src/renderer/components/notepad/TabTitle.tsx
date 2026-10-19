import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import type { ScratchpadNote } from './scratchpad-state.js'

/** One note tab: click to select, double-click to rename inline, × to close. */
export function TabTitle({
  note,
  active,
  onSelect,
  onRename,
  onClose,
}: {
  note: ScratchpadNote
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onClose: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = useCallback((): void => {
    const next = draft.trim()
    onRename(next === '' ? note.title : next)
    setEditing(false)
  }, [draft, note.title, onRename])

  return (
    <div
      className={cn(
        'group flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12.5px]',
        active
          ? 'border-border bg-surface-3 text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-surface-1',
      )}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              setDraft(note.title)
              setEditing(false)
            }
          }}
          className="w-24 bg-transparent font-mono text-[12px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(note.title)
            setEditing(true)
          }}
          className="max-w-[10rem] truncate font-mono"
          title={note.title}
        >
          {note.title}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${note.title}`}
        className="grid size-4 place-items-center rounded text-muted-foreground opacity-0 hover:bg-surface-3 hover:text-foreground group-hover:opacity-100"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </div>
  )
}
