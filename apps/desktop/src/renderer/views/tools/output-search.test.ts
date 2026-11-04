import { describe, expect, it } from 'vitest'
import { splitMatches } from './OutputPane.js'

describe('splitMatches', () => {
  it('flags every match, ignoring case, and keeps the text around them', () => {
    expect(splitMatches('Open port, open PORT', 'port')).toEqual([
      { text: 'Open ', match: false },
      { text: 'port', match: true },
      { text: ', open ', match: false },
      { text: 'PORT', match: true },
    ])
  })

  it('treats the query as plain text, not a pattern', () => {
    expect(splitMatches('a.b axb (c)', 'a.b').filter((p) => p.match)).toEqual([{ text: 'a.b', match: true }])
    expect(splitMatches('f(x) and (c)', '(c)').filter((p) => p.match)).toEqual([{ text: '(c)', match: true }])
  })

  it('returns the text whole when nothing matches', () => {
    expect(splitMatches('nothing here', 'zzz')).toEqual([{ text: 'nothing here', match: false }])
  })
})
