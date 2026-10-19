import { describe, expect, it } from 'vitest'
import { allowPermission, externalUrl, isAppUrl } from './security.js'

const DEV = 'http://localhost:61337/'
const PACKAGED = 'file:///opt/Executioner/resources/app.asar/out/renderer/index.html'

describe('isAppUrl', () => {
  it('accepts the dev server origin, any route on it', () => {
    expect(isAppUrl('http://localhost:61337/#/findings', DEV)).toBe(true)
    expect(isAppUrl('http://localhost:61337/other', DEV)).toBe(true)
  })

  it('accepts only the packaged index file, hash routes included', () => {
    expect(isAppUrl(`${PACKAGED}#/about`, PACKAGED)).toBe(true)
    expect(isAppUrl('file:///home/user/.ssh/id_rsa', PACKAGED)).toBe(false)
  })

  it('refuses a remote page, another port, and junk', () => {
    expect(isAppUrl('https://evil.example/', DEV)).toBe(false)
    expect(isAppUrl('http://localhost:61338/', DEV)).toBe(false)
    expect(isAppUrl('https://evil.example/', PACKAGED)).toBe(false)
    expect(isAppUrl('not a url', DEV)).toBe(false)
  })
})

describe('externalUrl', () => {
  it('lets web links out', () => {
    expect(externalUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c')
    expect(externalUrl('http://example.com')).toBe('http://example.com/')
  })

  it('keeps every other scheme in', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'ms-msdt:/id', 'nonsense']) {
      expect(externalUrl(url)).toBeNull()
    }
  })
})

describe('allowPermission', () => {
  it('grants what the app uses, to the app only', () => {
    expect(allowPermission('notifications', DEV, DEV)).toBe(true)
    expect(allowPermission('clipboard-sanitized-write', DEV, DEV)).toBe(true)
    expect(allowPermission('notifications', 'https://evil.example/', DEV)).toBe(false)
  })

  it('refuses everything else', () => {
    for (const permission of ['media', 'geolocation', 'openExternal', 'clipboard-read', 'fullscreen']) {
      expect(allowPermission(permission, DEV, DEV)).toBe(false)
    }
  })
})
