import type { JSX } from 'react'
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { StickyNote } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { NotepadWindow } from './notepad/NotepadWindow.js'
import { clampFab, FAB_KEY, loadFabPos } from './notepad/fab-position.js'

/**
 * A global, app-wide scratchpad: a floating button (a parked launcher)
 * opens a movable floating window holding a multi-tab plain-text notepad.
 * Everything the user types auto-saves to localStorage under a single key so
 * notes survive closing the window and quitting/relaunching the whole app. The
 * window position is persisted alongside it under a sibling key so the pad
 * reopens where the user left it. No store, no server: a local convenience tool.
 *
 * The data model, the window geometry and the launcher's own position math live
 * in ./notepad; they are re-exported here so this module stays the public entry
 * point for the whole scratchpad.
 */

export {
  SCRATCHPAD_STORAGE_KEY,
  createEmptyScratchpad,
  serializeScratchpad,
  parseScratchpad,
} from './notepad/scratchpad-state.js'
export type { ScratchpadNote, ScratchpadState } from './notepad/scratchpad-state.js'

export {
  SCRATCHPAD_WINDOW_KEY,
  SCRATCHPAD_WINDOW_SIZE,
  clampWindow,
  defaultWindowPos,
  parseWindowPos,
} from './notepad/window-geometry.js'
export type { ScratchpadWindow, Viewport, Size } from './notepad/window-geometry.js'

/**
 * The parked launcher: a draggable, high-z floating button that
 * toggles the scratchpad window. Drag it anywhere (position persisted); a plain
 * click without a drag toggles the window. Defaults to the bottom-left.
 */
export function FloatingNotepad(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(loadFabPos)

  useEffect(() => {
    const onResize = (): void => setPos((p) => clampFab(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onMouseDown = (e: ReactMouseEvent): void => {
    if (e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY }
    const origin = { ...pos }
    let moved = false
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!moved && Math.hypot(dx, dy) > 4) moved = true
      if (moved) setPos(clampFab({ x: origin.x + dx, y: origin.y + dy }))
    }
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!moved) {
        setOpen((v) => !v)
        return
      }
      const final = clampFab({ x: origin.x + (ev.clientX - start.x), y: origin.y + (ev.clientY - start.y) })
      setPos(final)
      try {
        localStorage.setItem(FAB_KEY, JSON.stringify(final))
      } catch {
        /* storage unavailable */
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <>
      <button
        type="button"
        onMouseDown={onMouseDown}
        aria-label="Scratchpad"
        aria-pressed={open}
        style={{ left: pos.x, top: pos.y }}
        className={cn(
          'fixed z-[55] grid size-10 cursor-grab place-items-center rounded-lg select-none active:cursor-grabbing',
          'border-transparent bg-card text-foreground',
          'shadow-[0_4px_12px_rgb(0_0_0_/_0.22),0_0_0_1px_var(--border-subtle)]',
          'hover:bg-accent',
          'dark:bg-accent dark:shadow-[0_6px_16px_rgb(0_0_0_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.22)]',
        )}
      >
        <StickyNote className="size-4" strokeWidth={1.75} />
      </button>
      {open && <NotepadWindow onClose={() => setOpen(false)} />}
    </>
  )
}
