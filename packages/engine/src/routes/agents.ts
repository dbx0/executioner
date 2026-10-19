import { execFile } from 'node:child_process'
import { Hono } from 'hono'

/**
 * Agent CLI availability probing for the Settings → Agents page. For each agent
 * we report whether its CLI binary is on PATH and, when we can get one, a
 * version string. The renderer validates the whole list on mount and re-checks a
 * single agent behind the per-card "Verify" button.
 *
 * The check is intentionally injectable (the `probe` dep): the real probe shells
 * out to `which`/`where` + `<binary> --version`, but tests supply a stub so the
 * suite never touches the host's PATH or spawns anything.
 */

/** The agents we can launch, mapped to the CLI binary each one resolves to. */
export interface AgentDescriptor {
  id: string
  name: string
  binary: string
}

/**
 * The canonical agent list. Mirrors packages/pty agentAdapters (claude, codex,
 * opencode, gemini, cursor, hermes). "claude-team" is intentionally absent — it
 * is a Claude team preset, not a separate CLI.
 */
export const AGENTS: AgentDescriptor[] = [
  { id: 'claude', name: 'Claude', binary: 'claude' },
  { id: 'codex', name: 'Codex', binary: 'codex' },
  { id: 'opencode', name: 'OpenCode', binary: 'opencode' },
  { id: 'gemini', name: 'Gemini', binary: 'gemini' },
  { id: 'cursor', name: 'Cursor', binary: 'cursor-agent' },
  { id: 'hermes', name: 'Hermes', binary: 'hermes' },
]

/** The result of probing one binary: is it present, and its version if known. */
export interface ProbeResult {
  installed: boolean
  /** A version string (e.g. "2.1.260") when the CLI reported one, else null. */
  version: string | null
  /** A short human reason when not installed (or probe failed), else null. */
  error: string | null
}

/** One agent's status, as returned by GET /agents and GET /agents/:id. */
export interface AgentStatus extends ProbeResult {
  id: string
  name: string
  binary: string
}

/** A probe implementation: resolve a binary's availability + version. */
export type AgentProbe = (binary: string) => Promise<ProbeResult>

const PROBE_TIMEOUT_MS = 3_000

/** Promisified execFile that resolves { code, stdout } and never rejects. */
function run(
  file: string,
  args: string[],
  timeout: number,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout, windowsHide: true }, (err, stdout) => {
        resolve({ ok: err === null, stdout: typeof stdout === 'string' ? stdout : '' })
      })
    } catch {
      resolve({ ok: false, stdout: '' })
    }
  })
}

/** Extract a short version token from `--version` output, or null. */
function parseVersion(binary: string, stdout: string): string | null {
  const line = stdout.split('\n').map((l) => l.trim()).find((l) => l !== '')
  if (line === undefined || line === '') return null
  // Prefer a semver-ish token; fall back to "<binary> <first line>".
  const semver = line.match(/\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z]+)*/)
  if (semver !== null) return `${binary} ${semver[0]}`
  return line.length > 48 ? line.slice(0, 48) : line
}

/**
 * The default probe. Resolves the binary on PATH (`which` on POSIX, `where` on
 * win32), and — when present — best-effort `<binary> --version` to capture a
 * version. Both steps carry a hard timeout so a wedged CLI can never hang the
 * request; a nonzero exit / timeout on `--version` still counts as installed
 * with a null version (some CLIs don't support the flag).
 */
export const defaultProbe: AgentProbe = async (binary) => {
  const isWin = process.platform === 'win32'
  const locate = isWin
    ? await run('where', [binary], PROBE_TIMEOUT_MS)
    : await run('/usr/bin/which', [binary], PROBE_TIMEOUT_MS)
  if (!locate.ok || locate.stdout.trim() === '') {
    return { installed: false, version: null, error: 'binary not on PATH' }
  }
  const versioned = await run(binary, ['--version'], PROBE_TIMEOUT_MS)
  const version = versioned.ok ? parseVersion(binary, versioned.stdout) : null
  return { installed: true, version, error: null }
}

/** Merge a descriptor + probe result into the wire status shape. */
function toStatus(agent: AgentDescriptor, result: ProbeResult): AgentStatus {
  return { id: agent.id, name: agent.name, binary: agent.binary, ...result }
}

export interface AgentRoutesDeps {
  /** Override the availability probe (tests). Defaults to the PATH probe. */
  probe?: AgentProbe
}

/**
 * Bearer-guarded agent-status routes. `GET /agents` probes every agent in
 * parallel; `GET /agents/:id` re-checks a single one (the Verify button).
 */
export function agentRoutes(deps: AgentRoutesDeps = {}): Hono {
  const app = new Hono()
  const probe = deps.probe ?? defaultProbe

  app.get('/agents', async (c) => {
    const statuses = await Promise.all(
      AGENTS.map(async (agent) => toStatus(agent, await probe(agent.binary))),
    )
    return c.json(statuses)
  })

  app.get('/agents/:id', async (c) => {
    const agent = AGENTS.find((a) => a.id === c.req.param('id'))
    if (agent === undefined) return c.json({ error: 'unknown agent' }, 404)
    return c.json(toStatus(agent, await probe(agent.binary)))
  })

  return app
}
