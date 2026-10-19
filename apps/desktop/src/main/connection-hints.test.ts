import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverSshKeys, parseSshConfig } from './connection-hints.js'

describe('parseSshConfig', () => {
  it('reads hostname, user, port and identity file out of a Host block', () => {
    const hosts = parseSshConfig(
      ['Host kali', '  HostName 10.0.0.5', '  User root', '  Port 2222', '  IdentityFile ~/.ssh/kali.key'].join('\n'),
      '/home/u',
    )
    expect(hosts).toEqual([
      { alias: 'kali', hostname: '10.0.0.5', user: 'root', port: 2222, identityFile: '/home/u/.ssh/kali.key' },
    ])
  })

  it('falls back to the alias when the block sets no HostName', () => {
    expect(parseSshConfig('Host box.internal\n  User kali', '/home/u')[0]).toMatchObject({
      alias: 'box.internal',
      hostname: 'box.internal',
      user: 'kali',
    })
  })

  it('skips wildcard patterns, which configure hosts rather than name one', () => {
    const hosts = parseSshConfig(
      ['Host *', '  User nobody', 'Host web-?', '  User nobody', 'Host real', '  HostName r.example'].join('\n'),
      '/home/u',
    )
    expect(hosts.map((h) => h.alias)).toEqual(['real'])
  })

  it('accepts = separators, case-insensitive keywords and ignores comments', () => {
    const hosts = parseSshConfig(['# a comment', 'HOST=api', '  hostname=api.internal', '  PORT=22'].join('\n'), '/home/u')
    expect(hosts[0]).toMatchObject({ alias: 'api', hostname: 'api.internal', port: 22 })
  })

  it('resolves a bare IdentityFile name against ~/.ssh', () => {
    expect(parseSshConfig('Host a\n  IdentityFile mykey', '/home/u')[0]?.identityFile).toBe('/home/u/.ssh/mykey')
  })

  it('returns nothing for an empty or unparseable config', () => {
    expect(parseSshConfig('', '/home/u')).toEqual([])
    expect(parseSshConfig('nonsense-without-a-host-block', '/home/u')).toEqual([])
  })
})

describe('discoverSshKeys', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exe-ssh-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds private keys by their public half, most conventional first', () => {
    for (const name of ['id_rsa', 'id_ed25519', 'work.key']) {
      writeFileSync(join(dir, name), 'private')
      writeFileSync(join(dir, `${name}.pub`), 'public')
    }
    // config/known_hosts have no .pub, so they are excluded without naming them.
    writeFileSync(join(dir, 'config'), 'Host a')
    writeFileSync(join(dir, 'known_hosts'), '')

    expect(discoverSshKeys(dir)).toEqual([join(dir, 'id_ed25519'), join(dir, 'id_rsa'), join(dir, 'work.key')])
  })

  it('ignores a public key whose private half is missing', () => {
    writeFileSync(join(dir, 'orphan.pub'), 'public')
    expect(discoverSshKeys(dir)).toEqual([])
  })

  it('returns nothing when there is no .ssh directory', () => {
    const missing = join(dir, 'nope')
    expect(discoverSshKeys(missing)).toEqual([])
    mkdirSync(missing)
    expect(discoverSshKeys(missing)).toEqual([])
  })
})
