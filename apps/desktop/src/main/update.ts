import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

/**
 * Update check and self-update. A new release is found off the redirect GitHub
 * serves for /releases/latest (no API call, so no rate limit), the same way the
 * install scripts resolve it. The app downloads the release asset itself, with
 * progress, and checks it against SHA256SUMS.txt. Restarting hands off to the
 * install script of the new tag: the app quits, a detached shell waits for it
 * to exit, runs install.sh / install.ps1 on the files already downloaded, and
 * opens the app again.
 */

export const REPO = 'dbx0/executioner'

export interface UpdateInfo {
  current: string
  latest: string
  tag: string
  /** The release page, for installs the script cannot update in place. */
  url: string
  /** Whether the Update button can install in place, or only open the release page. */
  canInstall: boolean
}

/** The tag a /releases/latest redirect landed on, or null when there is no release. */
export function tagFromReleaseUrl(url: string): string | null {
  const match = /\/releases\/tag\/([^/?#]+)$/.exec(url)
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null
}

function parseVersion(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** True when `latest` is a strictly newer plain x.y.z than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (a === null || b === null) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export type InstallKind = 'linux' | 'mac' | 'windows'

/**
 * Which install script can replace this copy of the app, or null when none can
 * (a dev run, a .deb, a raw AppImage, an app moved somewhere else). Only the
 * locations the install scripts write to qualify.
 */
export function installKind(opts: {
  packaged: boolean
  platform: string
  execPath: string
  home: string
  localAppData?: string | undefined
}): InstallKind | null {
  if (!opts.packaged) return null
  const { execPath, home } = opts
  if (opts.platform === 'linux') {
    return execPath.startsWith(join(home, '.local', 'opt', 'executioner') + sep) ? 'linux' : null
  }
  if (opts.platform === 'darwin') {
    const bundles = ['/Applications/Executioner.app/', join(home, 'Applications', 'Executioner.app') + '/']
    return bundles.some((b) => execPath.startsWith(b)) ? 'mac' : null
  }
  if (opts.platform === 'win32' && opts.localAppData !== undefined) {
    const dir = join(opts.localAppData, 'Programs', 'Executioner') + sep
    return execPath.toLowerCase().startsWith(dir.toLowerCase()) ? 'windows' : null
  }
  return null
}

export async function checkForUpdate(opts: {
  current: string
  kind: InstallKind | null
  fetch?: typeof fetch
}): Promise<UpdateInfo | null> {
  const doFetch = opts.fetch ?? fetch
  const res = await doFetch(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', redirect: 'follow' })
  const tag = tagFromReleaseUrl(res.url)
  if (tag === null || !isNewer(tag, opts.current)) return null
  return {
    current: opts.current,
    latest: tag.replace(/^v/, ''),
    tag,
    url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`,
    canInstall: opts.kind !== null,
  }
}

/** The release asset the install script for this platform installs. */
export function releaseAsset(kind: InstallKind, version: string, arch: string): string {
  if (kind === 'linux') return `Executioner-${version}-linux-x86_64.AppImage`
  if (kind === 'mac') return `Executioner-${version}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
  return `Executioner-${version}-win-x64-setup.exe`
}

/** The sha256 SHA256SUMS.txt lists for `asset`, or null when it is not listed. */
export function expectedChecksum(sums: string, asset: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const [hash, name] = line.trim().split(/\s+/)
    if (hash !== undefined && (name === asset || name === `*${asset}`)) return hash.toLowerCase()
  }
  return null
}

export interface DownloadProgress {
  received: number
  /** Null when the server did not send a length. */
  total: number | null
}

async function fetchOk(doFetch: typeof fetch, url: string): Promise<Response> {
  const res = await doFetch(url, { redirect: 'follow' })
  if (!res.ok || res.body === null) throw new Error(`download failed (${res.status}): ${url}`)
  return res
}

/**
 * Download the install script, SHA256SUMS.txt and the release asset for `tag`
 * into `dir`, reporting progress on the asset, and verify its checksum. Throws
 * on any failure; the caller discards `dir`.
 */
export async function downloadUpdate(opts: {
  kind: InstallKind
  tag: string
  arch: string
  dir: string
  fetch?: typeof fetch
  onProgress?: (p: DownloadProgress) => void
}): Promise<void> {
  const doFetch = opts.fetch ?? fetch
  const base = `https://github.com/${REPO}/releases/download/${encodeURIComponent(opts.tag)}`
  const script = opts.kind === 'windows' ? 'install.ps1' : 'install.sh'
  const asset = releaseAsset(opts.kind, opts.tag.replace(/^v/, ''), opts.arch)

  const scriptRes = await fetchOk(doFetch, `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(opts.tag)}/${script}`)
  await writeFile(join(opts.dir, script), await scriptRes.text())
  const sums = await (await fetchOk(doFetch, `${base}/SHA256SUMS.txt`)).text()
  await writeFile(join(opts.dir, 'SHA256SUMS.txt'), sums)
  const expected = expectedChecksum(sums, asset)
  if (expected === null) throw new Error(`${asset} is not listed in SHA256SUMS.txt`)

  const res = await fetchOk(doFetch, `${base}/${encodeURIComponent(asset)}`)
  const length = Number(res.headers.get('content-length'))
  const total = Number.isFinite(length) && length > 0 ? length : null
  const hash = createHash('sha256')
  let received = 0
  let reported = 0
  opts.onProgress?.({ received, total })
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk)
      received += chunk.length
      // About every 1%, or every 512KB without a length: plenty for a bar.
      if (received - reported >= (total === null ? 512 * 1024 : total / 100)) {
        reported = received
        opts.onProgress?.({ received, total })
      }
      done(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), count, createWriteStream(join(opts.dir, asset)))
  opts.onProgress?.({ received, total: total ?? received })
  if (hash.digest('hex') !== expected) throw new Error(`checksum mismatch for ${asset}`)
}

// The scripts read their inputs from the environment, never from interpolated
// strings, so a path cannot inject shell. The install script finds the files
// already downloaded through EXECUTIONER_DOWNLOAD_DIR and checks them again.
const POSIX_SCRIPT = `
while kill -0 "$EXE_PID" 2>/dev/null; do sleep 0.2; done
bash "$EXECUTIONER_DOWNLOAD_DIR/install.sh"
rm -rf "$EXECUTIONER_DOWNLOAD_DIR"
if [ "$EXE_KIND" = mac ]; then open "$EXE_RELAUNCH"; else "$EXE_RELAUNCH" >/dev/null 2>&1 & fi
`

const WINDOWS_SCRIPT = `
Wait-Process -Id $env:EXE_PID -ErrorAction SilentlyContinue
try { & (Join-Path $env:EXECUTIONER_DOWNLOAD_DIR 'install.ps1') } catch { Write-Error $_ }
Remove-Item -Recurse -Force $env:EXECUTIONER_DOWNLOAD_DIR -ErrorAction SilentlyContinue
Start-Process -FilePath $env:EXE_RELAUNCH
`

/** What gets reopened once the install finishes: the AppImage's AppRun, the .app bundle, or the exe. */
export function relaunchTarget(kind: InstallKind, execPath: string): string {
  if (kind === 'linux') return join(dirname(execPath), 'AppRun')
  if (kind === 'mac') return dirname(dirname(dirname(execPath)))
  return execPath
}

/**
 * Start the detached installer on a finished download. The caller quits the
 * app right after: the script waits for this process to exit before replacing
 * its files. If the install fails the old copy is left in place and is opened
 * again.
 */
export function startInstall(opts: { kind: InstallKind; tag: string; dir: string; execPath: string; pid: number }): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EXE_PID: String(opts.pid),
    EXE_KIND: opts.kind,
    EXE_RELAUNCH: relaunchTarget(opts.kind, opts.execPath),
    EXECUTIONER_VERSION: opts.tag,
    EXECUTIONER_DOWNLOAD_DIR: opts.dir,
  }
  // The packaged app runs the engine with ELECTRON_RUN_AS_NODE; the relaunched
  // app must not inherit it.
  delete env.ELECTRON_RUN_AS_NODE
  const child =
    opts.kind === 'windows'
      ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env,
        })
      : spawn('/bin/bash', ['-c', POSIX_SCRIPT], { detached: true, stdio: 'ignore', env, cwd: homedir() })
  child.unref()
}
