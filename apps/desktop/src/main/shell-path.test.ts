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
  it('puts shell-only entries ahead of the inherited entry they precede, without duplicates', () => {
    expect(mergePath('/home/u/.local/bin:/usr/bin', '/usr/bin:/bin')).toBe('/home/u/.local/bin:/usr/bin:/bin')
  })

  it('keeps the inherited order and slots shell-only entries in where the shell put them', () => {
    // A desktop session lists mise shims before ~/.local/bin; an rc file that
    // prepends ~/.local/bin must not flip that, or a ~/.local/bin wrapper that
    // execs `mise x claude -- claude` resolves to itself forever.
    const shell = '/h/.local/bin:/h/mise/installs/claude:/h/mise/shims:/usr/bin'
    const inherited = '/h/mise/shims:/usr/bin:/h/mise/shims:/h/.local/bin'
    expect(mergePath(shell, inherited)).toBe('/h/mise/installs/claude:/h/mise/shims:/usr/bin:/h/.local/bin')
  })

  it('appends shell entries that come after every inherited one', () => {
    expect(mergePath('/usr/bin:/opt/x/bin', '/usr/bin:/bin')).toBe('/usr/bin:/bin:/opt/x/bin')
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
