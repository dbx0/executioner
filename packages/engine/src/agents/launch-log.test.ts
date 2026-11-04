import * as fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseLine, type LogLine } from '@exe/protocol'
import { engineLog } from '../infra/log.js'
import { LoggedPtyRegistry, argvShape, cliName } from './launch-log.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeSync: vi.fn() }
})

const exits: Array<(code: number) => void> = []
vi.mock('@exe/pty', () => ({
  PtyRegistry: class {
    create(_id: string, options: { command: string }) {
      if (options.command === 'missing') throw new Error('spawn missing ENOENT')
      return { pid: 4242, onExit: (fn: (code: number) => void) => exits.push(fn) }
    }
  },
}))

const lines = (): LogLine[] =>
  vi
    .mocked(fs.writeSync)
    .mock.calls.map((c) => parseLine(String(c[1]).trim()))
    .filter((l): l is LogLine => l !== null && l.src === 'engine/agents')

beforeEach(() => {
  vi.mocked(fs.writeSync).mockClear()
  exits.length = 0
})
afterEach(() => engineLog.setLevel('info'))

describe('cliName', () => {
  it('keeps the bare name only', () => {
    expect(cliName('/home/someone/.local/bin/claude')).toBe('claude')
    expect(cliName('C:\\Users\\someone\\AppData\\codex.cmd')).toBe('codex')
  })
})

describe('argvShape', () => {
  it('keeps flags and replaces every other argument by its length', () => {
    expect(argvShape(['-p', 'scan acme.com now', '--mcp-config', '/tmp/x.json'])).toEqual([
      '-p',
      '[17 chars]',
      '--mcp-config',
      '[11 chars]',
    ])
  })
})

describe('LoggedPtyRegistry', () => {
  const options = {
    command: '/usr/bin/claude',
    args: ['-p', 'the secret prompt'],
    cwd: '/tmp',
    env: { EXE_TOKEN: 'value-never-logged' },
    unsetEnv: ['CLAUDECODE'],
  }

  it('logs the launch and exit at info with cli, code and duration', () => {
    new LoggedPtyRegistry().create('a', options)
    exits[0]?.(3)
    const got = lines()
    expect(got.map((l) => [l.lvl, l.msg])).toEqual([
      ['info', 'Launched'],
      ['info', 'Exited'],
    ])
    expect(got[1]?.data).toMatchObject({ cli: 'claude', code: 3 })
    expect(typeof got[1]?.data?.ms).toBe('number')
  })

  it('logs argv shape and env names at debug, never the prompt or env values', () => {
    engineLog.setLevel('debug')
    new LoggedPtyRegistry().create('a', options)
    const debug = lines().find((l) => l.msg === 'Launch command')
    expect(debug?.data).toEqual({ cli: 'claude', args: ['-p', '[17 chars]'], env: ['EXE_TOKEN'], unsetEnv: ['CLAUDECODE'] })
    const all = JSON.stringify(lines())
    expect(all).not.toContain('secret prompt')
    expect(all).not.toContain('value-never-logged')
  })

  it('logs a failed launch at warn and rethrows', () => {
    expect(() => new LoggedPtyRegistry().create('a', { ...options, command: 'missing' })).toThrow('ENOENT')
    expect(lines()[0]).toMatchObject({ lvl: 'warn', msg: 'Launch failed', data: { cli: 'missing' } })
  })
})
