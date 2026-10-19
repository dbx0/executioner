// ---------------------------------------------------------------------------
// The parked launcher button: geometry + position persistence.
// ---------------------------------------------------------------------------

export const FAB_SIZE = 40
// v2: reset any previously stored parked position that sat too near the bottom,
// so the higher default (defaultFabPos) takes effect for existing users too.
export const FAB_KEY = 'exe.scratchpad.fab.v2'

export function clampFab(p: { x: number; y: number }): { x: number; y: number } {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, vw - FAB_SIZE)),
    y: Math.min(Math.max(0, p.y), Math.max(0, vh - FAB_SIZE)),
  }
}

/** Default parked position: over the left sidebar (centered in its ~240px
 *  width), sitting well clear of the status bar rather than near the bottom. */
export function defaultFabPos(): { x: number; y: number } {
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  return clampFab({ x: 100, y: vh - FAB_SIZE - 100 })
}

export function loadFabPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(FAB_KEY)
    if (raw !== null) {
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
      if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        return clampFab({ x: p.x, y: p.y })
      }
    }
  } catch {
    /* storage unavailable */
  }
  return defaultFabPos()
}
