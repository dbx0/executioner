import { describe, expect, it } from 'vitest'
import { crashReloadUrl } from './recovery'

describe('crashReloadUrl', () => {
  it('reloads a web address for a call that does not navigate', () => {
    expect(crashReloadUrl('https://x/a', { action: 'eval', args: {} })).toBe('https://x/a')
    expect(crashReloadUrl('http://x/', { action: 'snapshot', args: {} })).toBe('http://x/')
    expect(crashReloadUrl('https://x/a', { action: 'ensure', args: {} })).toBe('https://x/a')
  })

  it('skips the reload when the call navigates anyway', () => {
    expect(crashReloadUrl('https://x/a', { action: 'navigate', args: { url: 'https://y/' } })).toBeUndefined()
    expect(crashReloadUrl('https://x/a', { action: 'ensure', args: { url: 'https://y/' } })).toBeUndefined()
  })

  it('never reloads an internal page such as the one that crashed it', () => {
    expect(crashReloadUrl('chrome://crash', { action: 'eval', args: {} })).toBeUndefined()
    expect(crashReloadUrl('about:blank', { action: 'eval', args: {} })).toBeUndefined()
    expect(crashReloadUrl('', { action: 'eval', args: {} })).toBeUndefined()
  })
})
