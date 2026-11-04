import { beforeEach, describe, expect, it } from 'vitest'
import { matchesPreset, presetsFor, readPresets, withPreset, withoutPreset, writePresets } from './presets.js'

describe('tool presets', () => {
  beforeEach(() => localStorage.removeItem('exe.toolPresets'))

  it('keeps presets per engagement and per tool', () => {
    let book = withPreset({}, '/a', 'nmap', { name: 'Quick', params: { ports: '1-100' } })
    book = withPreset(book, '/b', 'nmap', { name: 'Full', params: { ports: '1-65535' } })

    expect(presetsFor(book, '/a', 'nmap').map((p) => p.name)).toEqual(['Quick'])
    expect(presetsFor(book, '/b', 'nmap').map((p) => p.name)).toEqual(['Full'])
    expect(presetsFor(book, '/a', 'whois')).toEqual([])
  })

  it('replaces a preset saved again under the same name, in place', () => {
    let book = withPreset({}, '/a', 'nmap', { name: 'Quick', params: { ports: '1-100' } })
    book = withPreset(book, '/a', 'nmap', { name: 'Full', params: { ports: '1-65535' } })
    book = withPreset(book, '/a', 'nmap', { name: 'Quick', params: { ports: '1-1000' } })

    expect(presetsFor(book, '/a', 'nmap')).toEqual([
      { name: 'Quick', params: { ports: '1-1000' } },
      { name: 'Full', params: { ports: '1-65535' } },
    ])
  })

  it('deletes only the named preset', () => {
    let book = withPreset({}, '/a', 'nmap', { name: 'Quick', params: {} })
    book = withPreset(book, '/a', 'nmap', { name: 'Full', params: {} })

    expect(presetsFor(withoutPreset(book, '/a', 'nmap', 'Quick'), '/a', 'nmap').map((p) => p.name)).toEqual(['Full'])
  })

  it('round-trips through storage and survives unreadable data', () => {
    writePresets(withPreset({}, '/a', 'nmap', { name: 'Quick', params: { ports: '1-100' } }))
    expect(presetsFor(readPresets(), '/a', 'nmap')).toEqual([{ name: 'Quick', params: { ports: '1-100' } }])

    localStorage.setItem('exe.toolPresets', '{not json')
    expect(readPresets()).toEqual({})
    localStorage.setItem('exe.toolPresets', '[]')
    expect(readPresets()).toEqual({})
  })

  it('matches a form only when every param is the same', () => {
    const preset = { name: 'Quick', params: { ports: '1-100', rate: 500 } }
    expect(matchesPreset({ rate: 500, ports: '1-100' }, preset)).toBe(true)
    expect(matchesPreset({ ports: '1-100' }, preset)).toBe(false)
    expect(matchesPreset({ ports: '1-100', rate: 501 }, preset)).toBe(false)
  })
})
