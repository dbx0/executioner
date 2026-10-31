import { describe, expect, it } from 'vitest'
import { matchRule, mergeHeaders, type Rule } from './rewrite'

describe('matchRule', () => {
  const req = { url: 'http://x/api/v1', method: 'GET', stage: 'request' as const }

  it('glob matching is anchored', () => {
    const at = (urlPattern: string, extra: Partial<Rule> = {}) => matchRule([{ urlPattern, ...extra }], req)
    expect(at('http://x/api/*')).toBeDefined()
    expect(at('*/api/v?')).toBeDefined()
    expect(at('http://x/api')).toBeUndefined()
    expect(at('/api/v1')).toBeUndefined()
    expect(at('http://x/api/v1.')).toBeUndefined()
    expect(at('http://x/api/v1', { method: 'post' })).toBeUndefined()
    expect(at('http://x/api/v1', { method: 'get' })).toBeDefined()
    expect(at('http://x/api/v1', { stage: 'response' })).toBeUndefined()
    expect(at('http://x/a.i/v1')).toBeUndefined()
    expect(at('http://x/api/v1+')).toBeUndefined()
    expect(at('http://x/api/(v1)')).toBeUndefined()
    expect(at('http://x/api/[v1]')).toBeUndefined()
    expect(at('http://x/api/v1$')).toBeUndefined()
    expect(at('http://x/api/v^1')).toBeUndefined()
    expect(matchRule([{ urlPattern: 'http://x/a+b(c)[d]$' }], { url: 'http://x/a+b(c)[d]$', method: 'GET', stage: 'request' })).toBeDefined()
    expect(matchRule([{ urlPattern: 'http://x/a+b(c)[d]$' }], { url: 'http://x/aab(c)d', method: 'GET', stage: 'request' })).toBeUndefined()
  })

  it('the first match wins', () => {
    const rules: Rule[] = [{ id: 'a', urlPattern: 'http://x/*' }, { id: 'b', urlPattern: '*' }]
    expect(matchRule(rules, { url: 'http://x/y', method: 'GET', stage: 'request' })?.id).toBe('a')
  })
})

describe('mergeHeaders', () => {
  it('replaces and removes case-insensitively', () => {
    const base = [
      { name: 'Accept', value: '*/*' },
      { name: 'X-Old', value: '1' },
    ]
    expect(mergeHeaders(base, { accept: 'text/html', 'x-old': null, 'X-New': '2' })).toEqual([
      { name: 'accept', value: 'text/html' },
      { name: 'X-New', value: '2' },
    ])
  })
})
