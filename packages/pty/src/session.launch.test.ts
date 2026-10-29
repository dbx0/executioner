import { beforeEach, describe, expect, it, vi } from 'vitest'

// The resolver is unit-tested on its own (windows-launch.test.ts); this only
// pins that every PtySession spawn goes through it, so a bare agent name is
// resolved the same way for the terminal, workflow and assistant launches.
const spawn = vi.fn((_command: string, _args: string[], _options: object) => ({ onData: vi.fn(), onExit: vi.fn(), pid: 1 }))
const resolveLaunch = vi.fn()
vi.mock('node-pty', () => ({ spawn }))
vi.mock('./windows-launch.js', () => ({ resolveLaunch }))

const { PtySession } = await import('./session.js')

describe('PtySession launch', () => {
  beforeEach(() => {
    spawn.mockClear()
    resolveLaunch.mockReset()
  })

  it('spawns what the launch resolver returns', () => {
    resolveLaunch.mockReturnValue({ command: 'C:\\bin\\claude.exe', args: ['--resume', 'x'] })
    new PtySession({ command: 'claude', args: ['--resume', 'x'], cwd: 'C:\\eng' })
    expect(spawn).toHaveBeenCalledWith('C:\\bin\\claude.exe', ['--resume', 'x'], expect.objectContaining({ cwd: 'C:\\eng' }))
  })

  it('resolves against the environment the child will get', () => {
    resolveLaunch.mockImplementation((command: string, args: string[]) => ({ command, args }))
    new PtySession({ command: 'opencode', args: [], cwd: '/eng', env: { PATH: '/agent/bin' } })
    const [command, args, env] = resolveLaunch.mock.calls[0] as [string, string[], Record<string, string>]
    expect(command).toBe('opencode')
    expect(args).toEqual([])
    expect(env.PATH).toBe('/agent/bin')
    expect(spawn.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ env }))
  })
})
