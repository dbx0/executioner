import { describe, expect, it, vi } from 'vitest'
import { extractPath, mergePath, resolveShellEnv } from './shell-path.js'

describe('extractPath', () => {
  it('pulls the PATH out from between the markers, ignoring rc noise', () => {
    const out = 'welcome banner\n__EXE_PATH__/a/bin:/usr/bin__EXE_PATH__\nbye'
    expect(extractPath(out)).toBe('/a/bin:/usr/bin')
  })

  it('returns null when the markers are missing or empty', () => {
    expect(extractPath('no markers here')).toBeNull()
    expect(extractPath('__EXE_PATH____EXE_PATH__')).toBeNull()
  })
})

describe('mergePath', () => {
  it('puts the shell entries first and keeps the inherited ones, without duplicates', () => {
    expect(mergePath('/home/u/.local/bin:/usr/bin', '/usr/bin:/bin')).toBe('/home/u/.local/bin:/usr/bin:/bin')
  })

  it('handles an empty inherited PATH', () => {
    expect(mergePath('/opt/homebrew/bin', undefined)).toBe('/opt/homebrew/bin')
  })
})

describe('resolveShellEnv', () => {
  const base = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/zsh' }

  it('replaces the bare GUI PATH with the login shell PATH on macOS', () => {
    const exec = vi.fn(() => '__EXE_PATH__/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin__EXE_PATH__')
    const env = resolveShellEnv(base, 'darwin', exec)
    expect(exec).toHaveBeenCalledWith('/bin/zsh', expect.arrayContaining(['-ilc']))
    expect(env.PATH).toBe('/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin')
  })

  it('leaves the env alone on windows', () => {
    const exec = vi.fn()
    expect(resolveShellEnv(base, 'win32', exec)).toEqual(base)
    expect(exec).not.toHaveBeenCalled()
  })

  it('falls back to the inherited env when the shell fails', () => {
    const exec = vi.fn(() => {
      throw new Error('timeout')
    })
    expect(resolveShellEnv(base, 'darwin', exec)).toEqual(base)
  })
})
