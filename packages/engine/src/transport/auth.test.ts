import { timingSafeEqual } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { generateToken, isAllowedOrigin, isLoopbackHost, timingSafeCompare } from './auth.js'

// Wrapped (not replaced) so the comparison still runs and its inputs can be seen.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) }
})

describe('generateToken', () => {
  it('produces a long url-safe token', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
  })

  it('produces a different token each time', () => {
    expect(generateToken()).not.toBe(generateToken())
  })
})

describe('timingSafeCompare', () => {
  it('is true for identical strings', () => {
    expect(timingSafeCompare('abc123', 'abc123')).toBe(true)
  })

  it('is false for different strings of the same length', () => {
    expect(timingSafeCompare('abc123', 'abc124')).toBe(false)
  })

  it('is false for different lengths without throwing', () => {
    expect(timingSafeCompare('abc', 'abcdef')).toBe(false)
  })

  it('is false when either side is empty', () => {
    expect(timingSafeCompare('', 'abc')).toBe(false)
    expect(timingSafeCompare('abc', '')).toBe(false)
  })

  it('compares fixed-size digests, so a wrong length takes the same constant-time path', () => {
    const spy = vi.mocked(timingSafeEqual)
    spy.mockClear()
    expect(timingSafeCompare('a', 'a much longer launch token')).toBe(false)
    expect(timingSafeCompare('a much longer launch token', 'a much longer launch token')).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
    for (const [left, right] of spy.mock.calls) {
      expect((left as Buffer).length).toBe(32)
      expect((right as Buffer).length).toBe(32)
    }
  })
})

describe('isLoopbackHost', () => {
  it('accepts the loopback names, with or without a port', () => {
    for (const host of ['127.0.0.1:4100', 'localhost:4100', 'LOCALHOST', '[::1]:4100', undefined]) {
      expect(isLoopbackHost(host)).toBe(true)
    }
  })

  it('refuses any other hostname', () => {
    for (const host of ['evil.example', 'evil.example:4100', '127.0.0.1.evil.example', '10.0.0.5:4100']) {
      expect(isLoopbackHost(host)).toBe(false)
    }
  })
})

describe('isAllowedOrigin', () => {
  it('allows the packaged renderer and a loopback dev server', () => {
    expect(isAllowedOrigin('null')).toBe(true)
    expect(isAllowedOrigin('file://')).toBe(true)
    expect(isAllowedOrigin('http://localhost:61337')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:61337')).toBe(true)
  })

  it('refuses web pages', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
    expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false)
    expect(isAllowedOrigin('not a url')).toBe(false)
  })
})
