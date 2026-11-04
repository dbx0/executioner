/**
 * Named param sets per tool ("quick scan", "full scan"), so the usual shapes
 * of a tool are one click rather than flags typed again. Kept per engagement on
 * this machine, the way the output pane's size is; they do not travel with the
 * engagement folder.
 */

/** One saved param set for a tool. */
export interface ParamPreset {
  name: string
  params: Record<string, unknown>
}

/** Every engagement's presets: root, then tool id, then the presets in save order. */
export type PresetBook = Record<string, Record<string, ParamPreset[]>>

const KEY = 'exe.toolPresets'

/** The saved presets; empty when there are none or storage cannot be read. */
export function readPresets(): PresetBook {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PresetBook) : {}
  } catch {
    return {}
  }
}

/** Keep the presets; a storage failure loses nothing already on screen. */
export function writePresets(book: PresetBook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(book))
  } catch {
    /* ignore */
  }
}

/** A tool's presets in one engagement. */
export function presetsFor(book: PresetBook, root: string, toolId: string): ParamPreset[] {
  return book[root]?.[toolId] ?? []
}

/** The book with this preset saved; one of the same name is replaced in place. */
export function withPreset(book: PresetBook, root: string, toolId: string, preset: ParamPreset): PresetBook {
  const list = presetsFor(book, root, toolId)
  const at = list.findIndex((p) => p.name === preset.name)
  const next = at === -1 ? [...list, preset] : list.map((p, i) => (i === at ? preset : p))
  return { ...book, [root]: { ...book[root], [toolId]: next } }
}

/** The book without the named preset. */
export function withoutPreset(book: PresetBook, root: string, toolId: string, name: string): PresetBook {
  const next = presetsFor(book, root, toolId).filter((p) => p.name !== name)
  return { ...book, [root]: { ...book[root], [toolId]: next } }
}

/** Whether the form's params are exactly this preset's. */
export function matchesPreset(params: Record<string, unknown>, preset: ParamPreset): boolean {
  const a = Object.keys(params)
  const b = Object.keys(preset.params)
  return a.length === b.length && a.every((k) => JSON.stringify(params[k]) === JSON.stringify(preset.params[k]))
}
