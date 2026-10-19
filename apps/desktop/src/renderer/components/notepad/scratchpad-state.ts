/**
 * The scratchpad's data model and its localStorage persistence. Pure helpers
 * live here so they can be unit-tested without mounting the notepad window.
 */

export interface ScratchpadNote {
  id: string
  title: string
  content: string
}

export interface ScratchpadState {
  notes: ScratchpadNote[]
  activeId: string
}

export const SCRATCHPAD_STORAGE_KEY = 'exe.scratchpad'

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through to the manual id */
  }
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** A fresh scratchpad with a single empty note — the cold-start state. */
export function createEmptyScratchpad(): ScratchpadState {
  const note: ScratchpadNote = { id: newId(), title: 'Note 1', content: '' }
  return { notes: [note], activeId: note.id }
}

/** Serialize the whole notepad for localStorage. Pure. */
export function serializeScratchpad(state: ScratchpadState): string {
  return JSON.stringify(state)
}

function isNote(value: unknown): value is ScratchpadNote {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.title === 'string' && typeof v.content === 'string'
}

/**
 * Parse a stored scratchpad back into a valid state. Tolerates null, malformed
 * JSON, and partial/garbage shapes by falling back to a fresh scratchpad. Always
 * returns at least one note with a valid activeId. Pure.
 */
export function parseScratchpad(raw: string | null): ScratchpadState {
  if (raw === null || raw === '') return createEmptyScratchpad()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return createEmptyScratchpad()
  }
  if (typeof data !== 'object' || data === null) return createEmptyScratchpad()
  const obj = data as Record<string, unknown>
  const notes = Array.isArray(obj.notes) ? obj.notes.filter(isNote) : []
  if (notes.length === 0) return createEmptyScratchpad()
  const activeId =
    typeof obj.activeId === 'string' && notes.some((n) => n.id === obj.activeId)
      ? obj.activeId
      : notes[0]!.id
  return { notes, activeId }
}

export function loadScratchpad(): ScratchpadState {
  try {
    return parseScratchpad(window.localStorage.getItem(SCRATCHPAD_STORAGE_KEY))
  } catch {
    return createEmptyScratchpad()
  }
}

export function saveScratchpad(state: ScratchpadState): void {
  try {
    window.localStorage.setItem(SCRATCHPAD_STORAGE_KEY, serializeScratchpad(state))
  } catch {
    /* localStorage can be full or disabled; losing a keystroke of scratch is fine */
  }
}
