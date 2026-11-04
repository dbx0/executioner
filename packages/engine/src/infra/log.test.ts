import * as fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseLine } from '@exe/protocol'
import { collectMasks, engineLog } from './log.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeSync: vi.fn() }
})

const writes = (): Array<{ fd: number; text: string }> =>
  vi.mocked(fs.writeSync).mock.calls.map((c) => ({ fd: c[0], text: String(c[1]) }))

beforeEach(() => {
  vi.mocked(fs.writeSync).mockClear()
  engineLog.setLevel('info')
  engineLog.setMasks([])
})
afterEach(() => {
  engineLog.setLevel('info')
  engineLog.setMasks([])
})

describe('engineLog', () => {
  it('writes one JSON line per call to fd 2 under an engine/<sub> source', () => {
    engineLog.info('scheduler', 'tick', { n: 1 })
    const [w] = writes()
    expect(writes()).toHaveLength(1)
    expect(w?.fd).toBe(2)
    expect(w?.text.endsWith('\n')).toBe(true)
    expect(parseLine(w?.text.trim() ?? '')).toMatchObject({ lvl: 'info', src: 'engine/scheduler', msg: 'tick', data: { n: 1 } })
  })

  it('drops debug at info and keeps it at debug', () => {
    engineLog.debug('x', 'quiet')
    expect(writes()).toHaveLength(0)
    engineLog.setLevel('debug')
    expect(engineLog.level()).toBe('debug')
    engineLog.debug('x', 'loud')
    expect(writes()).toHaveLength(1)
  })

  it('masks values given to setMasks', () => {
    engineLog.setMasks(['hunter2-secret'])
    engineLog.warn('x', 'token hunter2-secret leaked', { v: 'hunter2-secret' })
    const text = writes()[0]?.text ?? ''
    expect(text).not.toContain('hunter2-secret')
    expect(text).toContain('[secret]')
  })
})

describe('addMask', () => {
  it('survives later setMasks refreshes', () => {
    engineLog.addMask('tok123456')
    engineLog.setMasks(['other-value'])
    engineLog.info('x', 'bearer tok123456 and other-value')
    const text = writes()[0]?.text ?? ''
    expect(text).not.toContain('tok123456')
    expect(text).not.toContain('other-value')
    expect(text).toContain('[secret]')
  })
})

describe('engineLog robustness', () => {
  it('does not throw on cyclic data', () => {
    const data: Record<string, unknown> = {}
    data.self = data
    expect(() => engineLog.error('x', 'cyc', data)).not.toThrow()
    expect(writes()[0]?.text).toContain('[circular]')
  })
})

describe('collectMasks', () => {
  it('returns secret and backend env values, deduplicated', () => {
    const masks = collectMasks({
      secrets: { map: () => ({ A: 'one-value', B: 'shared-value' }) },
      backends: { list: () => [{ env: { X: 'shared-value', Y: 'env-value' } }, {}] },
    })
    expect(masks.sort()).toEqual(['env-value', 'one-value', 'shared-value'])
  })
})
