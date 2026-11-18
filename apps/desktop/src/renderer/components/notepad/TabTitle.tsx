import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { Input } from '../ui/input.js'
import { segmentClass } from '../ui/segmented.js'
import type { ScratchpadNote } from './scratchpad-state.js'

/** One note tab: click to select, double-click to rename inline, the cross to close. */
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
      className={cn(segmentClass(active), 'group h-[26px] gap-1 pl-3 pr-1.5 text-[12.5px] focus-within:ring-[3px] focus-within:ring-ring/50')}
    >
      {editing ? (
        <Input
          ref={inputRef}
          aria-label="Note title"
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
          className="h-5 w-24 rounded-none border-0 bg-transparent px-0 py-0 font-mono text-[12px] focus-visible:ring-0"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(note.title)
            setEditing(true)
          }}
          className="max-w-[10rem] truncate font-mono outline-none"
          title={note.title}
        >
          {note.title}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${note.title}`}
        className="grid size-4 place-items-center rounded-full text-muted-foreground opacity-0 outline-none hover:bg-glass-active hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </div>
  )
}
