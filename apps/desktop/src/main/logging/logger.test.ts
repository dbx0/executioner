import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LogLine } from '@exe/protocol'
import { MainLogger, rendererLine } from './logger'

function sink(): { lines: LogLine[]; write(line: LogLine): void } {
  const lines: LogLine[] = []
  return { lines, write: (line) => lines.push(line) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MainLogger', () => {
  it('buffers lines until the mask list loads, then writes them masked and in order', () => {
    const session = sink()
    const logger = new MainLogger({ session })
    logger.info('main', 'first')
    logger.info('main', 'key is censys_x here')
    logger.warn('main', 'third', { note: 'censys_x' })
    expect(session.lines).toEqual([])

    logger.setMasks(['censys_x'])
    expect(session.lines.map((l) => l.msg)).toEqual(['first', 'key is [secret] here', 'third'])
    expect(session.lines[2]!.data).toEqual({ note: '[secret]' })
    logger.info('main', 'after censys_x')
    expect(session.lines[3]!.msg).toBe('after [secret]')
  })

  it('writes pattern-redacted lines and one warning when the mask list never arrives', async () => {
    const session = sink()
    const logger = new MainLogger({ session, maskTimeoutMs: 10 })
    logger.info('main', 'Authorization: Bearer abcdef123456')
    logger.info('main', 'second', { password: 'hunter22' })
    await new Promise((r) => setTimeout(r, 30))
    expect(session.lines.map((l) => l.msg)).toEqual([
      'Authorization: [secret]',
      'second',
      'Known-value masking is unavailable for this session',
    ])
    expect(session.lines[1]!.data).toEqual({ password: '[secret]' })
    expect(session.lines.filter((l) => l.lvl === 'warn')).toHaveLength(1)
    // Lines after the fallback go straight through.
    logger.info('main', 'later')
    expect(session.lines.at(-1)!.msg).toBe('later')
  })

  it('flushes buffered lines on fatal error', () => {
    const session = sink()
    const logger = new MainLogger({ session })
    logger.info('main', 'one')
    logger.info('main', 'two')
    logger.flushUnmasked('uncaughtException')
    expect(session.lines.map((l) => l.msg)).toEqual(['one', 'two', 'Known-value masking is unavailable for this session'])
    expect(session.lines[2]!.data).toEqual({ reason: 'uncaughtException' })
    // A second flush, or masks arriving late, write no second warning.
    logger.flushUnmasked('again')
    logger.setMasks([])
    expect(session.lines).toHaveLength(3)
  })

  it('drops debug at info and writes it after setLevel(debug)', () => {
    const session = sink()
    const logger = new MainLogger({ session })
    logger.setMasks([])
    expect(logger.level()).toBe('info')
    logger.debug('main', 'hidden')
    logger.setLevel('debug')
    expect(logger.level()).toBe('debug')
    logger.debug('main', 'shown')
    expect(session.lines.map((l) => l.msg)).toEqual(['shown'])
  })

  it('masks an engine bearer token added with addMask', () => {
    const session = sink()
    const logger = new MainLogger({ session })
    logger.setMasks(['censys_x'])
    logger.addMask('0123456789abcdef0123')
    logger.log({ lvl: 'info', src: 'engine:abc', msg: 'token=0123456789abcdef0123 and ws?t 0123456789abcdef0123' })
    expect(session.lines[0]!.msg).not.toContain('0123456789abcdef0123')
    // Later mask lists keep the tokens.
    logger.setMasks(['other-value'])
    logger.info('main', 'again 0123456789abcdef0123')
    expect(session.lines[1]!.msg).toBe('again [secret]')
  })

  it('stamps a time when the line has none and keeps a given one', () => {
    const session = sink()
    const logger = new MainLogger({ session })
    logger.setMasks([])
    logger.log({ lvl: 'info', src: 'engine:x', msg: 'given', t: '2026-01-01T00:00:00.000Z' })
    logger.info('main', 'stamped')
    expect(session.lines[0]!.t).toBe('2026-01-01T00:00:00.000Z')
    expect(Number.isNaN(Date.parse(session.lines[1]!.t))).toBe(false)
  })

  it('never throws when the session write fails', () => {
    const logger = new MainLogger({
      session: {
        write: () => {
          throw new Error('disk full')
        },
      },
    })
    logger.setMasks([])
    expect(() => logger.error('main', 'boom')).not.toThrow()
  })
})

describe('rendererLine', () => {
  it('accepts a well-formed line and forces the renderer source', () => {
    expect(rendererLine({ lvl: 'warn', src: 'main', msg: 'hi' })).toMatchObject({ lvl: 'warn', src: 'renderer', msg: 'hi' })
    expect(rendererLine({ lvl: 'info', src: 'renderer/boundary', msg: 'x' })?.src).toBe('renderer/boundary')
    expect(rendererLine({ lvl: 'info', msg: 'x', data: { a: 1 } })?.data).toEqual({ a: 1 })
  })

  it('rejects a bad level, a non-string message or non-object data', () => {
    expect(rendererLine({ lvl: 'fatal', msg: 'x' })).toBeNull()
    expect(rendererLine({ lvl: 'info', msg: 3 })).toBeNull()
    expect(rendererLine({ lvl: 'info', msg: 'x', data: [1] })).toBeNull()
    expect(rendererLine({ lvl: 'info', msg: 'x', data: 'y' })).toBeNull()
    expect(rendererLine(null)).toBeNull()
  })

  it('drops a line over 16 KB', () => {
    expect(rendererLine({ lvl: 'info', msg: 'x'.repeat(17 * 1024) })).toBeNull()
    expect(rendererLine({ lvl: 'info', msg: 'x', data: { big: 'y'.repeat(17 * 1024) } })).toBeNull()
  })
})
