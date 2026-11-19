import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { StickyNote, Plus, X } from 'lucide-react'
import { Button } from '../ui/button.js'
import { Textarea } from '../ui/textarea.js'
import { TabTitle } from './TabTitle.js'
import {
  createEmptyScratchpad,
  loadScratchpad,
  newId,
  saveScratchpad,
  type ScratchpadNote,
  type ScratchpadState,
} from './scratchpad-state.js'
import {
  clampWindow,
  currentViewport,
  loadWindowPos,
  saveWindowPos,
  SCRATCHPAD_WINDOW_SIZE,
  type ScratchpadWindow,
} from './window-geometry.js'

/** The movable floating window holding the multi-tab plain-text notepad. */
export function NotepadWindow({ onClose }: { onClose: () => void }): JSX.Element {
  const [state, setState] = useState<ScratchpadState>(() => loadScratchpad())
  const [pos, setPos] = useState<ScratchpadWindow>(() => loadWindowPos())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Live pointer offset between the cursor and the window's top-left while
  // dragging; null when we're not dragging. A ref so the move handler stays
  // stable and doesn't re-subscribe on every mouse move.
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)

  // Debounced auto-save: every change is persisted, but batched so a fast typist
  // doesn't hammer localStorage on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => saveScratchpad(state), 250)
    return () => clearTimeout(t)
  }, [state])

  // Persist the window position (debounced) whenever it settles somewhere new.
  useEffect(() => {
    const t = setTimeout(() => saveWindowPos(pos), 200)
    return () => clearTimeout(t)
  }, [pos])

  // Header drag: track the pointer globally while the button is held so the drag
  // continues even if the cursor outruns the window; clamp to keep it on-screen.
  const onHeaderMouseDown = useCallback((e: ReactMouseEvent): void => {
    // Ignore clicks that land on real controls (close button, etc.).
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, input')) return
    e.preventDefault()
    setPos((p) => {
      dragOffset.current = { dx: e.clientX - p.x, dy: e.clientY - p.y }
      return p
    })

    const onMove = (ev: MouseEvent): void => {
      const off = dragOffset.current
      if (!off) return
      const viewport = currentViewport()
      setPos(
        clampWindow(
          { x: ev.clientX - off.dx, y: ev.clientY - off.dy },
          viewport,
          SCRATCHPAD_WINDOW_SIZE,
        ),
      )
    }
    const onUp = (): void => {
      dragOffset.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Keep the window visible if the OS window shrinks under it.
  useEffect(() => {
    const onResize = (): void => {
      setPos((p) => clampWindow(p, currentViewport(), SCRATCHPAD_WINDOW_SIZE))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const active = useMemo(
    () => state.notes.find((n) => n.id === state.activeId) ?? state.notes[0]!,
    [state],
  )

  const setContent = useCallback((content: string): void => {
    setState((s) => ({
      ...s,
      notes: s.notes.map((n) => (n.id === s.activeId ? { ...n, content } : n)),
    }))
  }, [])

  const renameNote = useCallback((id: string, title: string): void => {
    setState((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, title } : n)) }))
  }, [])

  const selectNote = useCallback((id: string): void => {
    setState((s) => ({ ...s, activeId: id }))
  }, [])

  const addNote = useCallback((): void => {
    setState((s) => {
      const n = s.notes.length + 1
      const note: ScratchpadNote = { id: newId(), title: `Note ${n}`, content: '' }
      return { notes: [...s.notes, note], activeId: note.id }
    })
  }, [])

  const closeNote = useCallback((id: string): void => {
    setState((s) => {
      const remaining = s.notes.filter((n) => n.id !== id)
      if (remaining.length === 0) return createEmptyScratchpad()
      const activeId = s.activeId === id ? remaining[remaining.length - 1]!.id : s.activeId
      return { notes: remaining, activeId }
    })
  }, [])

  return (
    <div
      className="fixed z-[60] flex max-h-[90vh] max-w-[96vw] flex-col overflow-hidden rounded-panel border border-glass-border bg-popover text-popover-foreground shadow-floating"
      // Geometry is data: the dragged position and the pad's fixed size.
      style={{
        left: pos.x,
        top: pos.y,
        width: SCRATCHPAD_WINDOW_SIZE.width,
        height: SCRATCHPAD_WINDOW_SIZE.height,
      }}
      role="dialog"
      aria-label="Scratchpad"
    >
      <div
        onMouseDown={onHeaderMouseDown}
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-glass-border py-2.5 pl-5 pr-2.5"
      >
        <StickyNote className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Scratchpad</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto cursor-pointer"
          onClick={onClose}
          aria-label="Close scratchpad"
        >
          <X className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

        <div className="flex shrink-0 items-center gap-1.5 px-3 py-2">
          <div className="glass-capsule scrollbar-none flex h-8 min-w-0 items-center gap-0.5 overflow-x-auto p-[3px]">
          {state.notes.map((note) => (
            <TabTitle
              key={note.id}
              note={note}
              active={note.id === state.activeId}
              onSelect={() => selectNote(note.id)}
              onRename={(title) => renameNote(note.id, title)}
              onClose={() => closeNote(note.id)}
            />
          ))}
          </div>
          <Button
            variant="glass"
            size="icon-sm"
            className="shrink-0"
            onClick={addNote}
            aria-label="New note"
          >
            <Plus className="size-4" strokeWidth={2} />
          </Button>
        </div>

        <Textarea
          ref={textareaRef}
          aria-label="Note"
          value={active.content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste or type anything…"
          spellCheck={false}
          className="min-h-0 flex-1 rounded-none border-0 bg-background px-5 py-4 font-mono text-[13px] leading-relaxed text-foreground focus-visible:ring-0"
        />

        <div className="shrink-0 border-t border-glass-border px-5 py-2 text-right text-[11px] text-muted-foreground">
          Saved automatically. Your notes stay here even after you close the app.
        </div>
    </div>
  )
}
