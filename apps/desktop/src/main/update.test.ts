import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, installKind, isNewer, relaunchTarget, tagFromReleaseUrl } from './update.js'

describe('tagFromReleaseUrl', () => {
  it('reads the tag off the /releases/latest redirect', () => {
    expect(tagFromReleaseUrl('https://github.com/dbx0/executioner/releases/tag/v0.0.3')).toBe('v0.0.3')
  })

  it('is null when there is no release to land on', () => {
    expect(tagFromReleaseUrl('https://github.com/dbx0/executioner/releases')).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares plain x.y.z numerically', () => {
    expect(isNewer('v0.0.10', '0.0.9')).toBe(true)
    expect(isNewer('v0.1.0', '0.0.9')).toBe(true)
    expect(isNewer('v0.0.2', '0.0.2')).toBe(false)
    expect(isNewer('v0.0.1', '0.0.2')).toBe(false)
  })

  it('ignores anything that is not a plain version', () => {
    expect(isNewer('v1.0.0-rc.1', '0.0.2')).toBe(false)
    expect(isNewer('latest', '0.0.2')).toBe(false)
  })
})

describe('installKind', () => {
  const home = '/home/u'

  it('only updates copies the install scripts put in place', () => {
    const base = { packaged: true, home }
    expect(installKind({ ...base, platform: 'linux', execPath: '/home/u/.local/opt/executioner/executioner' })).toBe('linux')
    expect(installKind({ ...base, platform: 'linux', execPath: '/opt/Executioner/executioner' })).toBeNull()
    expect(installKind({ ...base, platform: 'darwin', execPath: '/Applications/Executioner.app/Contents/MacOS/Executioner' })).toBe('mac')
    expect(installKind({ ...base, platform: 'darwin', execPath: '/home/u/Applications/Executioner.app/Contents/MacOS/Executioner' })).toBe('mac')
    expect(installKind({ ...base, platform: 'darwin', execPath: '/Volumes/Executioner/Executioner.app/Contents/MacOS/Executioner' })).toBeNull()
  })

  it('never updates a dev run', () => {
    expect(installKind({ packaged: false, platform: 'linux', home, execPath: '/home/u/.local/opt/executioner/executioner' })).toBeNull()
  })
})

describe('relaunchTarget', () => {
  it('reopens through AppRun on Linux and the bundle on macOS', () => {
    expect(relaunchTarget('linux', '/home/u/.local/opt/executioner/executioner')).toBe('/home/u/.local/opt/executioner/AppRun')
    expect(relaunchTarget('mac', '/Applications/Executioner.app/Contents/MacOS/Executioner')).toBe('/Applications/Executioner.app')
  })
})

describe('checkForUpdate', () => {
  const landOn = (url: string) => vi.fn(() => Promise.resolve({ url } as Response))

  it('reports a newer release with its page', async () => {
    const info = await checkForUpdate({
      current: '0.0.2',
      kind: 'linux',
      fetch: landOn('https://github.com/dbx0/executioner/releases/tag/v0.0.3'),
    })
    expect(info).toEqual({
      current: '0.0.2',
      latest: '0.0.3',
      tag: 'v0.0.3',
      url: 'https://github.com/dbx0/executioner/releases/tag/v0.0.3',
      canInstall: true,
    })
  })

  it('is null when already on the latest release', async () => {
    const info = await checkForUpdate({
      current: '0.0.3',
      kind: null,
      fetch: landOn('https://github.com/dbx0/executioner/releases/tag/v0.0.3'),
    })
    expect(info).toBeNull()
  })
})
