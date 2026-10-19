const MIN_AUTO_SAVE_DELAY_MS = 500
const MAX_AUTO_SAVE_DELAY_MS = 30_000
export const DEFAULT_AUTO_SAVE_DELAY_MS = 1000

export interface AutosaveParams {
  enabled: boolean
  dirty: boolean
  /** True while a changed-on-disk conflict is unresolved. */
  suspended: boolean
  delayMs: number
  save: () => void
}

/**
 * Schedule one debounced autosave, returning its canceller.
 *
 * Autosave never fires while suspended: resolving a conflict by silently
 * overwriting newer external content is the exact failure the banner exists to
 * prevent. The delay is clamped because it is user-editable, and a tiny value
 * degenerates into a save loop.
 */
export function scheduleAutosave(params: AutosaveParams): () => void {
  const { enabled, dirty, suspended, delayMs, save } = params
  if (!enabled || !dirty || suspended) {
    return () => {}
  }
  const clamped = Math.min(Math.max(delayMs, MIN_AUTO_SAVE_DELAY_MS), MAX_AUTO_SAVE_DELAY_MS)
  const timer = setTimeout(save, clamped)
  return () => clearTimeout(timer)
}
