import { readFileSync, statSync } from 'node:fs'
import { win32 } from 'node:path'

/** The command and argv a PTY should actually be spawned with. */
export interface Launch {
  command: string
  args: string[]
}

/** What {@link resolveLaunch} needs from the machine; tests swap in a fake one. */
export interface LaunchHost {
  platform: NodeJS.Platform
  isFile(path: string): boolean
  readFile(path: string): string
}

const realHost: LaunchHost = {
  platform: process.platform,
  isFile: (path) => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  readFile: (path) => readFileSync(path, 'utf8'),
}

/** What `where` and cmd.exe fall back to when PATHEXT is unset. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'
/** Of the PATHEXT types, the only ones CreateProcess launches directly. */
const EXECUTABLES = new Set(['.exe', '.com'])
const BATCH_FILES = new Set(['.cmd', '.bat'])
const NODE_SCRIPTS = new Set(['.js', '.cjs', '.mjs'])

/** Windows env names are case-insensitive, but a copied env object's keys are not. */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/**
 * Find `name` on Path the way `where` does: each directory in order, trying
 * each PATHEXT extension within it. Only types CreateProcess or an npm shim
 * can launch count, so the extensionless `claude` shell script npm writes
 * beside `claude.cmd` is never picked.
 */
function findOnPath(name: string, env: Record<string, string | undefined>, host: LaunchHost): string | undefined {
  const launchable = (ext: string): boolean => EXECUTABLES.has(ext) || BATCH_FILES.has(ext)
  const own = win32.extname(name).toLowerCase()
  const candidates =
    own !== '' && launchable(own)
      ? [name]
      : (envValue(env, 'PATHEXT') ?? DEFAULT_PATHEXT)
          .split(';')
          .map((ext) => ext.trim().toLowerCase())
          .filter(launchable)
          .map((ext) => name + ext)
  const dirs = (envValue(env, 'PATH') ?? '')
    .split(';')
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter((dir) => dir !== '')
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const path = win32.join(dir, candidate)
      if (host.isFile(path)) return path
    }
  }
  return undefined
}

/**
 * See through an npm `.cmd` shim to what it runs. Going through cmd.exe would
 * re-parse every argument (quotes, `%`, `^`, newlines in a prompt), so the
 * shim's target is launched directly: a native executable as itself, a node
 * script under the same node.exe the shim would pick.
 */
function unwrapShim(
  shim: string,
  args: string[],
  env: Record<string, string | undefined>,
  host: LaunchHost
): Launch | undefined {
  let body: string
  try {
    body = host.readFile(shim)
  } catch {
    return undefined
  }
  // The line that forwards `%*` names the target as "%dp0%\<relative path>".
  const forward = body.split(/\r?\n/).find((line) => line.includes('%*'))
  const targets = [...(forward ?? '').matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => m[1])
  const relative = targets[targets.length - 1]
  if (relative === undefined) return undefined
  const dir = win32.dirname(shim)
  const target = win32.join(dir, relative)
  const ext = win32.extname(target).toLowerCase()
  if (EXECUTABLES.has(ext)) return { command: target, args }
  if (!NODE_SCRIPTS.has(ext)) return undefined
  const besideShim = win32.join(dir, 'node.exe')
  const node = host.isFile(besideShim) ? besideShim : findOnPath('node', env, host)
  if (node === undefined || !EXECUTABLES.has(win32.extname(node).toLowerCase())) return undefined
  return { command: node, args: [target, ...args] }
}

/**
 * Turn a bare command name into something node-pty can spawn on Windows.
 *
 * node-pty only looks for a file named exactly `command` on Path (no PATHEXT,
 * and it skips the last entry), so a bare `claude` fails with "File not found"
 * even though `where claude` finds `claude.exe` or `claude.cmd`. Resolving to
 * a full path here makes the spawn find what the agent probe found. Anything
 * that cannot be resolved is returned unchanged and the spawn reports it.
 */
export function resolveLaunch(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  host: LaunchHost = realHost
): Launch {
  const unchanged = { command, args }
  if (host.platform !== 'win32') return unchanged
  // A path is the caller's explicit choice; only bare names are looked up.
  if (/[\\/:]/.test(command)) return unchanged
  const found = findOnPath(command, env, host)
  if (found === undefined) return unchanged
  if (EXECUTABLES.has(win32.extname(found).toLowerCase())) return { command: found, args }
  return unwrapShim(found, args, env, host) ?? unchanged
}
