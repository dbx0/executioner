// ---------------------------------------------------------------------------
// Movable window: position persistence + geometry helpers (pure, testable).
// ---------------------------------------------------------------------------

/** Top-left corner of the floating window, in viewport pixels. */
export interface ScratchpadWindow {
  x: number
  y: number
}

export interface Viewport {
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Sibling key to SCRATCHPAD_STORAGE_KEY holding just the window position. */
export const SCRATCHPAD_WINDOW_KEY = 'exe.scratchpad.win'

/** Fixed window footprint — used for both layout and clamp math so they agree. */
export const SCRATCHPAD_WINDOW_SIZE: Size = { width: 680, height: 520 }

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Keep the whole window inside the viewport so it can never be dragged fully
 * off-screen (the header always stays reachable). When the viewport is smaller
 * than the window the max collapses to 0, pinning it to the top-left. Pure.
 */
export function clampWindow(pos: ScratchpadWindow, viewport: Viewport, size: Size): ScratchpadWindow {
  const maxX = Math.max(0, viewport.width - size.width)
  const maxY = Math.max(0, viewport.height - size.height)
  return { x: clampNumber(pos.x, 0, maxX), y: clampNumber(pos.y, 0, maxY) }
}

/** A sensible first-open position: bottom-right, near the FAB. Pure. */
export function defaultWindowPos(viewport: Viewport, size: Size): ScratchpadWindow {
  const margin = 24
  return clampWindow(
    { x: viewport.width - size.width - margin, y: viewport.height - size.height - margin * 2 },
    viewport,
    size,
  )
}

/**
 * Parse a stored window position. Returns null for anything missing or malformed
 * so the caller can fall back to the default. Pure.
 */
export function parseWindowPos(raw: string | null): ScratchpadWindow | null {
  if (raw === null || raw === '') return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (
    typeof obj.x !== 'number' ||
    typeof obj.y !== 'number' ||
    !Number.isFinite(obj.x) ||
    !Number.isFinite(obj.y)
  ) {
    return null
  }
  return { x: obj.x, y: obj.y }
}

export function currentViewport(): Viewport {
  if (typeof window === 'undefined') return { width: SCRATCHPAD_WINDOW_SIZE.width, height: SCRATCHPAD_WINDOW_SIZE.height }
  return { width: window.innerWidth, height: window.innerHeight }
}

export function loadWindowPos(): ScratchpadWindow {
  const viewport = currentViewport()
  let stored: ScratchpadWindow | null
  try {
    stored = parseWindowPos(window.localStorage.getItem(SCRATCHPAD_WINDOW_KEY))
  } catch {
    stored = null
  }
  const pos = stored ?? defaultWindowPos(viewport, SCRATCHPAD_WINDOW_SIZE)
  return clampWindow(pos, viewport, SCRATCHPAD_WINDOW_SIZE)
}

export function saveWindowPos(pos: ScratchpadWindow): void {
  try {
    window.localStorage.setItem(SCRATCHPAD_WINDOW_KEY, JSON.stringify(pos))
  } catch {
    /* localStorage can be full or disabled; a lost window position is harmless */
  }
}
