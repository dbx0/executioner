import { execFileSync } from 'node:child_process'

/**
 * A GUI app launched from Finder, the Dock or an in-place update on macOS gets
 * launchd's bare PATH (/usr/bin:/bin:/usr/sbin:/sbin), not the one the user's
 * shell builds. Agent CLIs live in ~/.local/bin, Homebrew, nvm and friends, so
 * the engine (which inherits this env) could not find them. We ask the user's
 * login shell for its PATH once at startup and hand that to every child.
 */

const MARKER = '__EXE_PATH__'
const TIMEOUT_MS = 5_000

/** Runs a program and returns its stdout; throws on failure or timeout. */
export type ExecSync = (file: string, args: string[]) => string

const defaultExec: ExecSync = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
    // Keep rc files from starting tmux / oh-my-zsh update prompts etc.
    env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' },
  })

/** The PATH printed between the two markers, or null when absent/empty. */
export function extractPath(stdout: string): string | null {
  const start = stdout.indexOf(MARKER)
  if (start === -1) return null
  const end = stdout.indexOf(MARKER, start + MARKER.length)
  if (end === -1) return null
  const value = stdout.slice(start + MARKER.length, end).trim()
  return value === '' ? null : value
}

/** The non-empty entries of a PATH, first occurrence only. */
function entries(path: string | undefined): string[] {
  return [...new Set((path ?? '').split(':').filter((dir) => dir !== ''))]
}

/**
 * The inherited PATH in its own order, with each entry only the shell knows
 * placed just before the next entry both share (or at the end). The inherited
 * order wins because a non-interactive `-ilc` shell skips prompt hooks, so the
 * order it prints can differ from a real terminal's: on Linux an rc that
 * prepends ~/.local/bin would land ahead of mise's tools, and a ~/.local/bin
 * wrapper running `mise x claude -- claude` would then exec itself forever.
 * macOS still gets ~/.local/bin and Homebrew ahead of /usr/bin, because the
 * shell lists them before the bare launchd entries.
 */
export function mergePath(shellPath: string, inherited: string | undefined): string {
  const base = entries(inherited)
  const known = new Set(base)
  const before = new Map<string, string[]>()
  let pending: string[] = []
  for (const dir of entries(shellPath)) {
    if (!known.has(dir)) {
      pending.push(dir)
    } else if (pending.length > 0) {
      before.set(dir, pending)
      pending = []
    }
  }
  return [...base.flatMap((dir) => [...(before.get(dir) ?? []), dir]), ...pending].join(':')
}

/**
 * The env with PATH replaced by the login shell's (merged with the inherited
 * one). Windows GUI apps already get the user PATH, so it is left as is; any
 * shell failure falls back to the inherited env rather than blocking startup.
 */
export function resolveShellEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  exec: ExecSync = defaultExec,
): NodeJS.ProcessEnv {
  if (platform === 'win32') return env
  const shell = env.SHELL ?? '/bin/zsh'
  try {
    // -i so PATH edits in .zshrc/.bashrc count, -l for .zprofile/.bash_profile.
    const stdout = exec(shell, ['-ilc', `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`])
    const shellPath = extractPath(stdout)
    if (shellPath === null) return env
    return { ...env, PATH: mergePath(shellPath, env.PATH) }
  } catch {
    return env
  }
}
