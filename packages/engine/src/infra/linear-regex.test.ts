import { describe, expect, it, vi } from 'vitest'
import { enableLinearRegex } from './linear-regex.js'

describe('enableLinearRegex', () => {
  it('leaves V8 flags alone when the process started with the linear engine on', () => {
    // Changing a V8 flag at runtime makes Electron's Node abort on the next
    // Worker, so a flag the desktop already passed must not be set again.
    const setFlags = vi.fn()
    enableLinearRegex({ supported: () => true, setFlags })
    expect(setFlags).not.toHaveBeenCalled()
  })

  it('turns the linear engine on when the process started without it', () => {
    const setFlags = vi.fn()
    enableLinearRegex({ supported: () => false, setFlags })
    expect(setFlags).toHaveBeenCalledWith('--enable-experimental-regexp-engine')
  })

  it('leaves linear regexes usable once imported', () => {
    expect(() => new RegExp('a+', 'l' as string)).not.toThrow()
  })
})
