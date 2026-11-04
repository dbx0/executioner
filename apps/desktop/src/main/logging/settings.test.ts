import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectiveLevel, pushEngineLevel, readLoggingSettings, writeLoggingSettings } from './settings'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-logging-settings-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('logging settings', () => {
  it('round-trips the verbose setting', () => {
    const file = join(dir, 'nested', 'logging.json')
    writeLoggingSettings(file, { verbose: true })
    expect(readLoggingSettings(file)).toEqual({ verbose: true })
    writeLoggingSettings(file, { verbose: false })
    expect(readLoggingSettings(file)).toEqual({ verbose: false })
  })

  it('reads a missing or corrupt file as verbose off', () => {
    expect(readLoggingSettings(join(dir, 'absent.json'))).toEqual({ verbose: false })
    const file = join(dir, 'logging.json')
    writeFileSync(file, '{not json')
    expect(readLoggingSettings(file)).toEqual({ verbose: false })
    writeFileSync(file, '{"verbose":"yes"}')
    expect(readLoggingSettings(file)).toEqual({ verbose: false })
  })
})

describe('effectiveLevel', () => {
  it('turns debug on from the flag or env without touching the saved file', () => {
    const file = join(dir, 'logging.json')
    writeLoggingSettings(file, { verbose: false })
    const before = readFileSync(file, 'utf8')
    expect(effectiveLevel({ verbose: false }, ['--verbose'], {})).toBe('debug')
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(effectiveLevel({ verbose: false }, [], { EXECUTIONER_VERBOSE: '1' })).toBe('debug')
    expect(effectiveLevel({ verbose: true }, [], {})).toBe('debug')
    expect(effectiveLevel({ verbose: false }, [], { EXECUTIONER_VERBOSE: '0' })).toBe('info')
  })
})

describe('pushEngineLevel', () => {
  it('PUTs the level to every engine with its bearer token and reports failures', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes(':2')) throw new Error('refused')
      return { ok: true, status: 204 }
    })
    const failed: string[] = []
    await pushEngineLevel(
      [
        { port: 1, token: 'tok-a', projectRoot: '/a' },
        { port: 2, token: 'tok-b', projectRoot: '/b' },
      ],
      'debug',
      fetchFn,
      (conn) => failed.push(conn.projectRoot),
    )
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:1/api/log-level', {
      method: 'PUT',
      headers: { Authorization: 'Bearer tok-a', 'Content-Type': 'application/json' },
      body: '{"level":"debug"}',
    })
    expect(failed).toEqual(['/b'])
  })
})
