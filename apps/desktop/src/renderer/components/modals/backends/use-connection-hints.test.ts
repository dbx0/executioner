import { describe, expect, it } from 'vitest'
import { hostPatch, splitTarget, RECOMMENDED_IMAGES } from './use-connection-hints.js'

describe('splitTarget', () => {
  it('splits the thing you would type after ssh', () => {
    expect(splitTarget('kali@10.0.0.5:2222')).toEqual({ host: '10.0.0.5', user: 'kali', port: '2222' })
  })

  it('takes just a user when no port is given', () => {
    expect(splitTarget('root@box.internal')).toEqual({ host: 'box.internal', user: 'root' })
  })

  it('leaves a bare host alone rather than inventing fields', () => {
    expect(splitTarget('box.internal')).toEqual({ host: 'box.internal' })
  })

  it('strips an ssh:// prefix', () => {
    expect(splitTarget('ssh://kali@box:22')).toEqual({ host: 'box', user: 'kali', port: '22' })
  })

  it('does not mistake an IPv6 address for a host:port', () => {
    expect(splitTarget('fe80::1')).toEqual({ host: 'fe80::1' })
    expect(splitTarget('root@fe80::1')).toEqual({ host: 'fe80::1', user: 'root' })
  })

  it('takes the port from a bracketed IPv6 address and unwraps it', () => {
    expect(splitTarget('[fe80::1]:22')).toEqual({ host: 'fe80::1', port: '22' })
  })

  it('keeps a non-numeric suffix in the host', () => {
    expect(splitTarget('box:notaport')).toEqual({ host: 'box:notaport' })
  })
})

describe('hostPatch', () => {
  it('applies everything a config entry knows', () => {
    expect(
      hostPatch({ alias: 'kali', hostname: '10.0.0.5', user: 'root', port: 2222, identityFile: '/k/id' }),
    ).toEqual({ host: '10.0.0.5', user: 'root', port: '2222', identityFile: '/k/id', authMethod: 'identity' })
  })

  it('omits what the entry leaves unset, so prefilled values survive', () => {
    expect(hostPatch({ alias: 'a', hostname: 'a.example' })).toEqual({ host: 'a.example' })
  })

  it('switches to identity auth when the entry names a key', () => {
    expect(hostPatch({ alias: 'a', hostname: 'a', identityFile: '/k/id' }).authMethod).toBe('identity')
  })
})

describe('RECOMMENDED_IMAGES', () => {
  it('leads with kali, which is what the tool nodes assume', () => {
    expect(RECOMMENDED_IMAGES[0]?.image).toBe('kalilinux/kali-rolling')
  })
})
