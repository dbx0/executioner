/**
 * The drag-and-drop contract between the Targets panel (drag source) and the
 * terminal (drop target). Dragging a target, sub-target, fact, or finding sets a
 * custom MIME so the terminal only reacts to our own drags (never hijacking an
 * OS file drop), plus `text/plain` for anything else that accepts a drop.
 *
 * The payload is a compact, paste-ready string: for a target it's the bare value
 * (an agent can then `get_target` it via MCP); for a fact/finding it's a short
 * readable reference line. Pasting the value works for every base agent, MCP or
 * not, which is why we default to it over an opaque reference token.
 */
export const TARGET_DND_MIME = 'application/x-exe-ref'

export interface TargetDragItem {
  kind: 'target' | 'fact' | 'finding'
  /** The paste-ready text written into the terminal on drop. */
  text: string
  /** The owning target's value, for context (targets: their own value). */
  target: string
}

/** Serialise a drag item onto a DataTransfer (both our MIME and text/plain). */
export function setTargetDrag(dt: DataTransfer, item: TargetDragItem): void {
  try {
    dt.setData(TARGET_DND_MIME, JSON.stringify(item))
    dt.setData('text/plain', item.text)
    dt.effectAllowed = 'copy'
  } catch {
    /* some environments restrict setData; the drag simply won't carry data */
  }
}

/** Read our paste-ready text from a drop, or null when it isn't one of our drags. */
export function readTargetDrag(dt: DataTransfer): string | null {
  const raw = dt.getData(TARGET_DND_MIME)
  if (raw === '') return null
  try {
    const item = JSON.parse(raw) as Partial<TargetDragItem>
    return typeof item.text === 'string' && item.text !== '' ? item.text : null
  } catch {
    return null
  }
}
