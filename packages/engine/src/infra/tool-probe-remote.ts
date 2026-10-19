import type { BackendProfile } from '@exe/protocol'
import { dockerInvocation, shQuote, sshInvocation } from './launcher.js'
import { spawnRun, type RunFn } from './backend-test.js'

/**
 * Batched tool probing over a backend connection.
 *
 * Probing a remote connection the way the local page does — one request per
 * program — would open one SSH connection (or spin one throwaway container) per
 * tool. Instead we build ONE shell script that walks every program, and send it
 * through the same launcher invocation builders the executor uses. A catalog of
 * thirty tools costs one connection.
 */

/** One program's availability on the probed connection. */
export interface RemoteProbeRow {
  program: string
  installed: boolean
  version: string | null
}

/** The outcome of a batch probe: rows, or an `error` when the link itself failed. */
export interface RemoteProbeResult {
  rows: RemoteProbeRow[]
  /** Set when the connection failed — the caller must NOT read this as "all missing". */
  error?: string
}

/** Timeouts (ms) for a whole batch. Docker gets more: it may pull the image. */
export const BATCH_TIMEOUTS = { ssh: 60_000, docker: 180_000 } as const

/** Marks where our output starts, so an SSH banner or MOTD never parses as a row. */
const BEGIN = 'EXE_PROBE_BEGIN'

/**
 * The probe script. For each program it resolves `command -v` and, when found,
 * takes the first line of `--version`, emitting `program<TAB>path<TAB>version`.
 *
 * `--version` is wrapped in `timeout` when the host has it, and every command
 * reads from /dev/null, so a tool that prompts or hangs cannot wedge the batch.
 */
export function probeScript(programs: string[]): string {
  const list = programs.map(shQuote).join(' ')
  return [
    `printf '%s\\n' ${shQuote(BEGIN)}`,
    `if command -v timeout >/dev/null 2>&1; then EXE_TO="timeout 3"; else EXE_TO=""; fi`,
    `for p in ${list}; do`,
    `  loc=$(command -v "$p" 2>/dev/null </dev/null || true)`,
    `  ver=""`,
    `  if [ -n "$loc" ]; then ver=$($EXE_TO "$p" --version 2>/dev/null </dev/null | head -n 1 | tr -d '\\r' || true); fi`,
    `  printf '%s\\t%s\\t%s\\n' "$p" "$loc" "$ver"`,
    `done`,
  ].join('\n')
}

/**
 * Pull a short version token out of a `--version` line, mirroring the local
 * probe's formatting so a remote badge reads identically to a local one.
 */
export function parseVersionLine(program: string, line: string): string | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  const semver = trimmed.match(/\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z]+)*/)
  if (semver !== null) return `${program} ${semver[0]}`
  return trimmed.length > 48 ? trimmed.slice(0, 48) : trimmed
}

/** Parse the script's stdout into one row per requested program (order preserved). */
export function parseProbeOutput(programs: string[], stdout: string): RemoteProbeRow[] {
  const lines = stdout.split('\n')
  const start = lines.findIndex((l) => l.trim() === BEGIN)
  const body = start === -1 ? lines : lines.slice(start + 1)
  const seen = new Map<string, RemoteProbeRow>()
  for (const line of body) {
    const parts = line.replace(/\r$/, '').split('\t')
    if (parts.length < 3) continue
    const [program = '', loc = '', ver = ''] = parts
    if (program === '') continue
    seen.set(program, {
      program,
      installed: loc.trim() !== '',
      version: loc.trim() === '' ? null : parseVersionLine(program, ver),
    })
  }
  // A program the script never reported (truncated output) counts as unknown,
  // not as installed — report it missing rather than inventing a version.
  return programs.map((p) => seen.get(p) ?? { program: p, installed: false, version: null })
}

/** Last non-empty line of stderr — the useful part of a connection failure. */
function failureReason(stderr: string, stdout: string, timedOut: boolean): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const tail = lines.length > 0 ? lines[lines.length - 1] : stdout.trim()
  const base = tail ?? ''
  if (base !== '') return base
  return timedOut ? 'the connection timed out' : 'the connection failed'
}

/**
 * Probe every program on one backend in a single round trip.
 *
 * A 'local' profile never reaches here (the route probes this machine directly).
 * When the connection itself fails the result carries `error` and no rows, so
 * the UI can say the connection is unreachable instead of painting every tool
 * red — a distinction that matters when a host is simply down.
 */
export async function probeBackendTools(
  profile: BackendProfile,
  programs: string[],
  run: RunFn = spawnRun,
): Promise<RemoteProbeResult> {
  if (programs.length === 0) return { rows: [] }
  const script = probeScript(programs)
  const invocation =
    profile.kind === 'ssh'
      ? sshInvocation(profile, 'sh', ['-c', script])
      : dockerInvocation(profile, 'sh', ['-c', script])
  const timeout = profile.kind === 'ssh' ? BATCH_TIMEOUTS.ssh : BATCH_TIMEOUTS.docker

  const outcome = await run(invocation.program, invocation.args, timeout)
  // The script itself always exits 0; a nonzero exit means ssh/docker failed to
  // run it at all. Missing the marker means the same thing (e.g. no shell).
  if (outcome.code !== 0 || !outcome.stdout.includes(BEGIN)) {
    return { rows: [], error: failureReason(outcome.stderr, outcome.stdout, outcome.timedOut) }
  }
  return { rows: parseProbeOutput(programs, outcome.stdout) }
}
