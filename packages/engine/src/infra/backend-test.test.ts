import { describe, expect, it, vi } from 'vitest'
import type { BackendProfileInput } from '@exe/protocol'
import { testBackend, type RunFn, type RunOutcome } from './backend-test.js'

const ok = (stdout: string): RunOutcome => ({ code: 0, stdout, stderr: '', timedOut: false })
const fail = (stderr: string, timedOut = false): RunOutcome => ({ code: 1, stdout: '', stderr, timedOut })

describe('testBackend', () => {
  it('local is trivially ok without spawning', async () => {
    const run = vi.fn<RunFn>()
    const res = await testBackend({ name: 'here', kind: 'local' }, run)
    expect(res.ok).toBe(true)
    expect(res.steps).toEqual([{ name: 'local', ok: true, detail: 'Runs on this machine.' }])
    expect(run).not.toHaveBeenCalled()
  })

  it('ssh ok when the token comes back on exit 0', async () => {
    const profile: BackendProfileInput = { name: 'box', kind: 'ssh', host: 'h', user: 'u' }
    const run: RunFn = async (program, args) => {
      expect(program).toBe('ssh')
      expect(args[args.length - 1]).toBe(`'echo' 'executioner-ok'`)
      return ok('executioner-ok\n')
    }
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(true)
    expect(res.steps).toEqual([{ name: 'Connect & run', ok: true, detail: 'u@h' }])
  })

  it('ssh fails with the stderr tail as the error', async () => {
    const profile: BackendProfileInput = { name: 'box', kind: 'ssh', host: 'h', user: 'u' }
    const run: RunFn = async () => fail('ssh: connect to host h port 22: Connection timed out')
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Connection timed out')
    expect(res.steps[0]).toMatchObject({ name: 'Connect & run', ok: false })
  })

  it('ssh timeout is reported', async () => {
    const profile: BackendProfileInput = { name: 'box', kind: 'ssh', host: 'h', user: 'u' }
    const run: RunFn = async () => ({ code: null, stdout: '', stderr: '', timedOut: true })
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('timed out')
  })

  it('ssh with a workdir: connects, then verifies the directory exists', async () => {
    const profile: BackendProfileInput = { name: 'box', kind: 'ssh', host: 'h', user: 'u', workdir: '/root/eng' }
    const calls: string[][] = []
    const run: RunFn = async (program, args) => {
      calls.push(args)
      const remote = args[args.length - 1] ?? ''
      if (remote.includes('echo')) return ok('executioner-ok\n') // connectivity (no cd)
      return ok('') // `test -d` succeeds
    }
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(true)
    expect(res.steps.map((s) => s.name)).toEqual(['Connect & run', 'Working directory'])
    // Connectivity is tested WITHOUT a `cd` into the workdir.
    expect(calls[0]?.[calls[0].length - 1]).not.toContain('cd ')
    expect(calls[1]?.[calls[1].length - 1]).toContain(`'test' '-d' '/root/eng'`)
  })

  it('ssh flags a missing workdir (host reachable) so the caller can offer to create it', async () => {
    const profile: BackendProfileInput = { name: 'box', kind: 'ssh', host: 'h', user: 'u', workdir: '/root/eng' }
    const run: RunFn = async (_p, args) => {
      const remote = args[args.length - 1] ?? ''
      return remote.includes('echo') ? ok('executioner-ok\n') : fail('') // test -d fails
    }
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(false)
    expect(res.missingWorkdir).toBe('/root/eng')
    expect(res.steps[0]).toMatchObject({ name: 'Connect & run', ok: true })
    expect(res.steps[1]).toMatchObject({ name: 'Working directory', ok: false })
  })

  it('ssh createWorkdir mkdir -p the directory then verifies it', async () => {
    const profile: BackendProfileInput = { name: 'box', kind: 'ssh', host: 'h', user: 'u', workdir: '/root/eng' }
    const calls: string[] = []
    const run: RunFn = async (_p, args) => {
      const remote = args[args.length - 1] ?? ''
      calls.push(remote)
      if (remote.includes('echo')) return ok('executioner-ok\n')
      if (remote.includes('mkdir')) return ok('')
      return ok('') // test -d now succeeds
    }
    const res = await testBackend(profile, run, { createWorkdir: true })
    expect(res.ok).toBe(true)
    expect(res.steps.map((s) => s.name)).toEqual(['Connect & run', 'Create directory'])
    expect(calls.some((r) => r.includes(`'mkdir' '-p' '/root/eng'`))).toBe(true)
  })

  it('docker runs pull then run when both succeed', async () => {
    const profile: BackendProfileInput = { name: 'kali', kind: 'docker', image: 'kali:latest' }
    const calls: string[][] = []
    const run: RunFn = async (program, args) => {
      calls.push([program, ...args])
      return program === 'docker' && args[0] === 'pull' ? ok('') : ok('executioner-ok\n')
    }
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(true)
    expect(res.steps.map((s) => s.name)).toEqual(['Pull image', 'Run container'])
    expect(calls[0]).toEqual(['docker', 'pull', 'kali:latest'])
    expect(calls[1]).toEqual(['docker', 'run', '--rm', '-i', 'kali:latest', 'echo', 'executioner-ok'])
  })

  it('docker stops at a failing pull and does not run', async () => {
    const profile: BackendProfileInput = { name: 'kali', kind: 'docker', image: 'nope:latest' }
    const run = vi.fn<RunFn>(async () => fail('Error response from daemon: pull access denied'))
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(false)
    expect(res.steps).toHaveLength(1)
    expect(res.steps[0]).toMatchObject({ name: 'Pull image', ok: false })
    expect(res.error).toContain('pull access denied')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('docker fails at the run step after a good pull', async () => {
    const profile: BackendProfileInput = { name: 'kali', kind: 'docker', image: 'kali:latest' }
    const run: RunFn = async (program, args) =>
      args[0] === 'pull' ? ok('') : fail('docker: Error response from daemon: no command')
    const res = await testBackend(profile, run)
    expect(res.ok).toBe(false)
    expect(res.steps.map((s) => s.name)).toEqual(['Pull image', 'Run container'])
    expect(res.steps[1]).toMatchObject({ ok: false })
    expect(res.error).toContain('no command')
  })
})
