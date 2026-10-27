import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

/**
 * Update check and self-update. A new release is found off the redirect GitHub
 * serves for /releases/latest (no API call, so no rate limit), the same way the
 * install scripts resolve it. Installing hands off to those scripts: the app
 * quits, a detached shell waits for it to exit, runs install.sh / install.ps1
 * pinned to the new tag (checksum-verified there), and opens the app again.
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

// The scripts read their inputs from the environment, never from interpolated
// strings, so a tag or path cannot inject shell.
const POSIX_SCRIPT = `
while kill -0 "$EXE_PID" 2>/dev/null; do sleep 0.2; done
curl -fsSL "$EXE_SCRIPT_URL" | bash
if [ "$EXE_KIND" = mac ]; then open "$EXE_RELAUNCH"; else "$EXE_RELAUNCH" >/dev/null 2>&1 & fi
`

const WINDOWS_SCRIPT = `
Wait-Process -Id $env:EXE_PID -ErrorAction SilentlyContinue
try { Invoke-RestMethod $env:EXE_SCRIPT_URL | Invoke-Expression } catch { Write-Error $_ }
Start-Process -FilePath $env:EXE_RELAUNCH
`

/** What gets reopened once the install finishes: the AppImage's AppRun, the .app bundle, or the exe. */
export function relaunchTarget(kind: InstallKind, execPath: string): string {
  if (kind === 'linux') return join(dirname(execPath), 'AppRun')
  if (kind === 'mac') return dirname(dirname(dirname(execPath)))
  return execPath
}

/**
 * Start the detached installer. The caller quits the app right after: the
 * script waits for this process to exit before replacing its files. If the
 * install fails the old copy is left in place and is opened again.
 */
export function startInstall(opts: { kind: InstallKind; tag: string; execPath: string; pid: number }): void {
  const script = opts.kind === 'windows' ? 'install.ps1' : 'install.sh'
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EXE_PID: String(opts.pid),
    EXE_KIND: opts.kind,
    EXE_SCRIPT_URL: `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(opts.tag)}/${script}`,
    EXE_RELAUNCH: relaunchTarget(opts.kind, opts.execPath),
    EXECUTIONER_VERSION: opts.tag,
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
