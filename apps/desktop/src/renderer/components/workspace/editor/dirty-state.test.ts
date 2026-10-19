import { describe, expect, it } from 'vitest'
import { isEditorContentUnchanged } from './dirty-state.js'

describe('isEditorContentUnchanged', () => {
  it('compares exactly when trailing whitespace matters', () => {
    expect(isEditorContentUnchanged('a\n', 'a', false)).toBe(false)
    expect(isEditorContentUnchanged('a', 'a', false)).toBe(true)
  })

  it('ignores trailing whitespace when asked', () => {
    expect(isEditorContentUnchanged('a\n\n', 'a', true)).toBe(true)
    expect(isEditorContentUnchanged('a', 'a   \n', true)).toBe(true)
  })

  it('still detects a real edit under trailing-whitespace tolerance', () => {
    expect(isEditorContentUnchanged('ab\n', 'a\n', true)).toBe(false)
  })

  it('detects leading whitespace changes even under tolerance', () => {
    expect(isEditorContentUnchanged(' a', 'a', true)).toBe(false)
  })

  it('treats two all-whitespace documents as unchanged under tolerance', () => {
    expect(isEditorContentUnchanged('   ', '\n\n', true)).toBe(true)
  })
})
