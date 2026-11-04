import { describe, expect, it } from 'vitest'
import { mergeFetchHeaders, sendsHeadersTo } from './screenshot-driver.js'

describe('mergeFetchHeaders', () => {
  it('keeps the browser headers and appends the extra ones', () => {
    const merged = mergeFetchHeaders({ 'User-Agent': 'Chrome', Accept: '*/*' }, { 'X-Bug-Hunter': 'bx0' })
    expect(merged).toContainEqual({ name: 'User-Agent', value: 'Chrome' })
    expect(merged).toContainEqual({ name: 'X-Bug-Hunter', value: 'bx0' })
  })

  it('replaces a header the extra set overrides, case-insensitively, rather than sending it twice', () => {
    const merged = mergeFetchHeaders({ 'User-Agent': 'Chrome' }, { 'user-agent': 'bx0-scanner' })
    const agents = merged.filter((h) => h.name.toLowerCase() === 'user-agent')
    expect(agents).toEqual([{ name: 'user-agent', value: 'bx0-scanner' }])
  })
})

describe('sendsHeadersTo', () => {
  it('sends the headers to the target host on any scheme or port', () => {
    expect(sendsHeadersTo('https://app.acme.com/api/me', 'http://app.acme.com')).toBe(true)
    expect(sendsHeadersTo('http://APP.acme.com:8080/x', 'https://app.acme.com/login')).toBe(true)
  })

  it('keeps them from third parties the page loads, sibling subdomains included', () => {
    expect(sendsHeadersTo('https://cdn.jsdelivr.net/lib.js', 'https://app.acme.com')).toBe(false)
    expect(sendsHeadersTo('https://www.google-analytics.com/collect', 'https://app.acme.com')).toBe(false)
    expect(sendsHeadersTo('https://static.acme.com/a.css', 'https://app.acme.com')).toBe(false)
  })

  it('sends nothing for a url it cannot parse', () => {
    expect(sendsHeadersTo('data:image/png;base64,AAAA', 'https://app.acme.com')).toBe(false)
    expect(sendsHeadersTo('', 'https://app.acme.com')).toBe(false)
  })
})
