import { describe, expect, it } from 'vitest'
import {
  clampWindow,
  createEmptyScratchpad,
  defaultWindowPos,
  parseScratchpad,
  parseWindowPos,
  serializeScratchpad,
  SCRATCHPAD_WINDOW_SIZE,
  type ScratchpadState,
} from './FloatingNotepad.js'

describe('scratchpad persistence helpers', () => {
  it('createEmptyScratchpad starts with a single empty Note 1', () => {
    const s = createEmptyScratchpad()
    expect(s.notes).toHaveLength(1)
    expect(s.notes[0]!.title).toBe('Note 1')
    expect(s.notes[0]!.content).toBe('')
    expect(s.activeId).toBe(s.notes[0]!.id)
  })

  it('round-trips a state through serialize/parse', () => {
    const state: ScratchpadState = {
      notes: [
        { id: 'a', title: 'Alpha', content: 'hello' },
        { id: 'b', title: 'Beta', content: 'world' },
      ],
      activeId: 'b',
    }
    const parsed = parseScratchpad(serializeScratchpad(state))
    expect(parsed).toEqual(state)
  })

  it('falls back to a fresh scratchpad for null (nothing stored)', () => {
    const parsed = parseScratchpad(null)
    expect(parsed.notes).toHaveLength(1)
    expect(parsed.notes[0]!.title).toBe('Note 1')
  })

  it('falls back for malformed JSON', () => {
    const parsed = parseScratchpad('{not json')
    expect(parsed.notes).toHaveLength(1)
  })

  it('drops malformed notes and keeps valid ones', () => {
    const raw = JSON.stringify({
      notes: [
        { id: 'a', title: 'Keep', content: 'x' },
        { id: 5, title: 'bad-id' },
        { title: 'no id', content: 'y' },
      ],
      activeId: 'a',
    })
    const parsed = parseScratchpad(raw)
    expect(parsed.notes).toHaveLength(1)
    expect(parsed.notes[0]!.id).toBe('a')
  })

  it('repairs an activeId that points at no surviving note', () => {
    const raw = JSON.stringify({
      notes: [{ id: 'a', title: 'A', content: '' }],
      activeId: 'gone',
    })
    const parsed = parseScratchpad(raw)
    expect(parsed.activeId).toBe('a')
  })

  it('falls back when notes is empty or missing', () => {
    expect(parseScratchpad(JSON.stringify({ notes: [], activeId: 'x' })).notes).toHaveLength(1)
    expect(parseScratchpad(JSON.stringify({ activeId: 'x' })).notes).toHaveLength(1)
  })
})

describe('scratchpad window position helpers', () => {
  const viewport = { width: 1440, height: 900 }
  const size = SCRATCHPAD_WINDOW_SIZE

  it('clampWindow keeps the window fully inside the viewport', () => {
    expect(clampWindow({ x: -50, y: -50 }, viewport, size)).toEqual({ x: 0, y: 0 })
    const bottomRight = clampWindow({ x: 99999, y: 99999 }, viewport, size)
    expect(bottomRight.x).toBe(viewport.width - size.width)
    expect(bottomRight.y).toBe(viewport.height - size.height)
  })

  it('clampWindow leaves an in-bounds position untouched', () => {
    expect(clampWindow({ x: 120, y: 80 }, viewport, size)).toEqual({ x: 120, y: 80 })
  })

  it('clampWindow pins to top-left when the viewport is smaller than the window', () => {
    expect(clampWindow({ x: 10, y: 10 }, { width: 200, height: 200 }, size)).toEqual({ x: 0, y: 0 })
  })

  it('defaultWindowPos sits in the bottom-right and stays on-screen', () => {
    const pos = defaultWindowPos(viewport, size)
    // Right edge is close to the viewport's right side (small margin).
    expect(viewport.width - (pos.x + size.width)).toBeLessThan(48)
    // Bottom edge is in the lower half of the viewport.
    expect(pos.y + size.height).toBeGreaterThan(viewport.height / 2)
    // Never off-screen.
    expect(pos.x).toBeGreaterThanOrEqual(0)
    expect(pos.y).toBeGreaterThanOrEqual(0)
    expect(pos.x).toBeLessThanOrEqual(viewport.width - size.width)
    expect(pos.y).toBeLessThanOrEqual(viewport.height - size.height)
  })

  it('parseWindowPos round-trips a valid position', () => {
    expect(parseWindowPos(JSON.stringify({ x: 12, y: 34 }))).toEqual({ x: 12, y: 34 })
  })

  it('parseWindowPos returns null for missing, malformed, or non-finite input', () => {
    expect(parseWindowPos(null)).toBeNull()
    expect(parseWindowPos('')).toBeNull()
    expect(parseWindowPos('{not json')).toBeNull()
    expect(parseWindowPos(JSON.stringify({ x: 'a', y: 1 }))).toBeNull()
    expect(parseWindowPos(JSON.stringify({ x: 1 }))).toBeNull()
    expect(parseWindowPos(JSON.stringify({ x: Infinity, y: 0 }))).toBeNull()
  })
})
