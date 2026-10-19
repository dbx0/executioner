import { describe, expect, it, vi } from 'vitest'
import { enrollSshKey, safeKeyName, type EnrollDeps } from './ssh-enroll.js'
import type { RunFn, RunOutcome } from './backend-test.js'

const ok = (stdout: string): RunOutcome => ({ code: 0, stdout, stderr: '', timedOut: false })
const fail = (stderr: string, timedOut = false): RunOutcome => ({ code: 1, stdout: '', stderr, timedOut })

const input = { host: 'h', user: 'u', password: 'secret', keyDir: '/tmp/keys' }

function deps(over: Partial<EnrollDeps> = {}): EnrollDeps {
  return {
    keygen: async ({ keyDir, keyName }) => ({
      identityFile: `${keyDir}/${keyName}.key`,
      publicKey: 'ssh-ed25519 AAAA executioner',
    }),
    install: async () => {},
    verify: (async () => ok('executioner-ok\n')) as RunFn,
    ...over,
  }
}

describe('safeKeyName', () => {
  it('sanitizes user@host into a filesystem-safe basename', () => {
    expect(safeKeyName('root', '10.0.0.5')).toBe('root@10.0.0.5')
    expect(safeKeyName('a/b', 'h:1')).toBe('a_b@h_1')
  })
})

describe('enrollSshKey', () => {
  it('succeeds: keygen + install + verify → ok with the identity file set', async () => {
    const verify = vi.fn<RunFn>(async (program, args) => {
      expect(program).toBe('ssh')
      expect(args).toContain('-i')
      expect(args[args.length - 1]).toBe(`'echo' 'executioner-ok'`)
      return ok('executioner-ok\n')
    })
    const res = await enrollSshKey(input, deps({ verify }))
    expect(res.ok).toBe(true)
    expect(res.identityFile).toBe('/tmp/keys/u@h.key')
    expect(res.steps.map((s) => s.name)).toEqual(['Generate key', 'Install key', 'Verify'])
    expect(res.steps.every((s) => s.ok)).toBe(true)
    expect(verify).toHaveBeenCalledOnce()
  })

  it('stops at keygen failure with a null identity file', async () => {
    const install = vi.fn()
    const res = await enrollSshKey(
      input,
      deps({
        keygen: async () => {
          throw new Error('ssh-keygen exited 1')
        },
        install,
      }),
    )
    expect(res.ok).toBe(false)
    expect(res.identityFile).toBeNull()
    expect(res.steps).toHaveLength(1)
    expect(res.steps[0]).toMatchObject({ name: 'Generate key', ok: false })
    expect(res.error).toContain('ssh-keygen')
    expect(install).not.toHaveBeenCalled()
  })

  it('reports an auth failure at install and never verifies', async () => {
    const verify = vi.fn<RunFn>()
    const res = await enrollSshKey(
      input,
      deps({
        install: async () => {
          throw new Error('Authentication failed — check the username/password')
        },
        verify,
      }),
    )
    expect(res.ok).toBe(false)
    expect(res.identityFile).toBeNull()
    expect(res.error).toContain('Authentication failed')
    expect(res.steps.map((s) => s.name)).toEqual(['Generate key', 'Install key'])
    expect(res.steps[1]).toMatchObject({ ok: false })
    expect(verify).not.toHaveBeenCalled()
  })

  it('fails when verify does not return the token (identity file null)', async () => {
    const res = await enrollSshKey(input, deps({ verify: (async () => fail('Permission denied (publickey)')) as RunFn }))
    expect(res.ok).toBe(false)
    expect(res.identityFile).toBeNull()
    expect(res.steps.map((s) => s.name)).toEqual(['Generate key', 'Install key', 'Verify'])
    expect(res.steps[2]).toMatchObject({ name: 'Verify', ok: false })
    expect(res.error).toContain('Permission denied')
  })

  it('reports a verify timeout', async () => {
    const res = await enrollSshKey(
      input,
      deps({ verify: (async () => ({ code: null, stdout: '', stderr: '', timedOut: true })) as RunFn }),
    )
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Connection timed out')
  })
})
