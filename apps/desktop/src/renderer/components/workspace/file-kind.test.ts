import { describe, expect, it } from 'vitest'
import { isMarkdownPath, looksBinary } from './file-kind.js'

describe('isMarkdownPath', () => {
  it('matches markdown extensions case-insensitively', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/guide.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('a/b/notes.Md')).toBe(true)
  })
  it('rejects non-markdown files', () => {
    expect(isMarkdownPath('main.ts')).toBe(false)
    expect(isMarkdownPath('markdown.txt')).toBe(false)
    expect(isMarkdownPath('noext')).toBe(false)
  })
})

describe('looksBinary', () => {
  it('flags content containing a NUL byte', () => {
    expect(looksBinary(`hello${String.fromCharCode(0)}world`)).toBe(true)
  })
  it('flags a heavy run of Unicode replacement chars', () => {
    expect(looksBinary('�'.repeat(50))).toBe(true)
  })
  it('treats normal text (and empty content) as not binary', () => {
    expect(looksBinary('# A normal markdown file\n\nWith prose.')).toBe(false)
    expect(looksBinary('')).toBe(false)
    // A stray replacement char in otherwise-clean text is tolerated.
    expect(looksBinary(`a fine string with one � glyph and lots of real text`)).toBe(false)
  })
})
