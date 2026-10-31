import { describe, expect, it } from 'vitest'
import { PageLog } from './page-log'

const entry = (text: string) => ({ kind: 'console' as const, text, url: 'http://x' })

describe('PageLog', () => {
  it('since returns entries after seq and the next cursor', () => {
    const log = new PageLog()
    log.push(entry('a'))
    log.push(entry('b'))
    const all = log.since()
    expect(all.entries.map((e) => e.text)).toEqual(['a', 'b'])
    expect(all.next).toBe(2)
    log.push(entry('c'))
    const rest = log.since(all.next)
    expect(rest.entries.map((e) => e.text)).toEqual(['c'])
    expect(rest.next).toBe(3)
    expect(log.since(rest.next)).toEqual({ entries: [], next: 3 })
  })

  it('drops the oldest past the cap', () => {
    const log = new PageLog(3)
    for (const t of ['a', 'b', 'c', 'd', 'e']) log.push(entry(t))
    expect(log.since().entries.map((e) => e.text)).toEqual(['c', 'd', 'e'])
  })
})
