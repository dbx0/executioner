import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkForUpdate,
  downloadUpdate,
  expectedChecksum,
  installKind,
  isNewer,
  MAC_INSTALL_LABEL,
  macInstallCommand,
  relaunchTarget,
  releaseAsset,
  tagFromReleaseUrl,
  windowsInstallCommand,
} from './update.js'

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

describe('macInstallCommand', () => {
  const argv = macInstallCommand({
    HOME: '/Users/u',
    PATH: '/usr/bin:/bin',
    EXE_PID: '42',
    EXECUTIONER_DOWNLOAD_DIR: '/tmp/dl dir',
    SECRET_TOKEN: 'nope',
  })

  it('submits the installer to launchd so it outlives the app', () => {
    expect(argv.slice(0, 6)).toEqual(['submit', '-l', MAC_INSTALL_LABEL, '--', '/usr/bin/env', '-i'])
    expect(argv.slice(-3, -1)).toEqual(['/bin/bash', '-c'])
  })

  it('passes the install variables as argv and leaves the rest behind', () => {
    expect(argv).toContain('HOME=/Users/u')
    expect(argv).toContain('EXE_PID=42')
    expect(argv).toContain('EXECUTIONER_DOWNLOAD_DIR=/tmp/dl dir')
    expect(argv).toContain(`EXE_LAUNCHD_LABEL=${MAC_INSTALL_LABEL}`)
    expect(argv.some((a) => a.startsWith('SECRET_TOKEN='))).toBe(false)
  })

  it('removes its own job however the script ends, so launchd runs it once', () => {
    expect(argv.at(-1)).toContain(`trap 'launchctl remove "$EXE_LAUNCHD_LABEL"' EXIT`)
  })
})

describe('windowsInstallCommand', () => {
  const argv = windowsInstallCommand()

  it('runs an attached launcher so powershell keeps a console', () => {
    // DETACHED_PROCESS leaves powershell.exe without a console and it exits 0
    // without running anything. startInstall spawns this argv without
    // detached:true, and the argv itself is a single -Command launcher (no
    // multiline script), so the launcher runs normally.
    expect(argv.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'])
  })

  it('starts the real installer in a hidden powershell via an encoded command', () => {
    const launcher = argv.at(-1) ?? ''
    expect(launcher).toContain('Start-Process -FilePath powershell.exe -WindowStyle Hidden')
    const encoded = /-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(launcher)?.[1] ?? ''
    const script = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(script).toContain('Wait-Process -Id $env:EXE_PID')
    expect(script).toContain("Join-Path $env:EXECUTIONER_DOWNLOAD_DIR 'install.ps1'")
    expect(script).toContain('Start-Process -FilePath $env:EXE_RELAUNCH')
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

describe('releaseAsset', () => {
  it('names the asset the install script for this platform takes', () => {
    expect(releaseAsset('linux', '0.0.7', 'x64')).toBe('Executioner-0.0.7-linux-x86_64.AppImage')
    expect(releaseAsset('mac', '0.0.7', 'arm64')).toBe('Executioner-0.0.7-mac-arm64.zip')
    expect(releaseAsset('mac', '0.0.7', 'x64')).toBe('Executioner-0.0.7-mac-x64.zip')
    expect(releaseAsset('windows', '0.0.7', 'x64')).toBe('Executioner-0.0.7-win-x64-setup.exe')
  })
})

describe('expectedChecksum', () => {
  it('finds the asset in text or binary mode lines', () => {
    const sums = 'AAA  Executioner-0.0.7-mac-arm64.zip\r\nbbb *Executioner-0.0.7-linux-x86_64.AppImage\n'
    expect(expectedChecksum(sums, 'Executioner-0.0.7-mac-arm64.zip')).toBe('aaa')
    expect(expectedChecksum(sums, 'Executioner-0.0.7-linux-x86_64.AppImage')).toBe('bbb')
    expect(expectedChecksum(sums, 'Executioner-0.0.7-win-x64-setup.exe')).toBeNull()
  })
})

describe('downloadUpdate', () => {
  const asset = 'Executioner-0.0.7-linux-x86_64.AppImage'
  const body = Buffer.alloc(300 * 1024, 7)
  const digest = createHash('sha256').update(body).digest('hex')

  function serve(sums: string) {
    return vi.fn((url: string) => {
      if (url.endsWith('/install.sh')) return Promise.resolve(new Response('#!/bin/bash\n'))
      if (url.endsWith('/SHA256SUMS.txt')) return Promise.resolve(new Response(sums))
      if (url.endsWith(`/${asset}`)) {
        return Promise.resolve(new Response(body, { headers: { 'content-length': String(body.length) } }))
      }
      return Promise.resolve(new Response('missing', { status: 404 }))
    }) as unknown as typeof fetch
  }

  it('saves the script, sums and verified asset, reporting progress', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exe-update-test-'))
    try {
      const onProgress = vi.fn()
      await downloadUpdate({ kind: 'linux', tag: 'v0.0.7', arch: 'x64', dir, fetch: serve(`${digest}  ${asset}\n`), onProgress })
      expect((await readFile(join(dir, asset))).equals(body)).toBe(true)
      expect(await readFile(join(dir, 'install.sh'), 'utf8')).toBe('#!/bin/bash\n')
      expect(onProgress).toHaveBeenLastCalledWith({ received: body.length, total: body.length })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses an asset whose checksum does not match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exe-update-test-'))
    try {
      await expect(
        downloadUpdate({ kind: 'linux', tag: 'v0.0.7', arch: 'x64', dir, fetch: serve(`${'0'.repeat(64)}  ${asset}\n`) }),
      ).rejects.toThrow('checksum mismatch')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
