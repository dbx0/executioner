import { Hono } from 'hono'
import { z } from 'zod'
import type { BackendProfile, ToolManifest } from '@exe/protocol'
import { defaultProbe, type AgentProbe } from './agents.js'
import { toolInstallHint, type InstallHint } from '../infra/tool-install.js'
import { spawnRun, type RunFn } from '../infra/backend-test.js'
import { probeBackendTools } from '../infra/tool-probe-remote.js'

/**
 * External-tool availability probing for the Settings → Tools page. The node
 * manifests each invoke an external CLI (`command.program`); this route collects
 * the UNIQUE set of those programs, probes each on PATH (present + version), and
 * attaches OS-specific install guidance for the ones that are missing.
 *
 * The probe is the same PATH + `--version` check the Agents page uses (reused
 * from ./agents), injectable for tests so the suite never spawns a process. The
 * manifest source is injectable too, so tests can supply fake manifests without
 * a project/registry.
 *
 * Tools can also be probed on a saved SSH/Docker connection. Those go through
 * `POST /tools/probe-batch`, which checks the whole catalog in ONE round trip —
 * per-tool probing would cost one SSH connection or one container per tool.
 */

/** One tool in the catalog (GET /tools) — no probe, so the list returns fast. */
export interface ToolInfo {
  /** The binary the manifests invoke (`command.program`). */
  program: string
  /** The `name`s of the nodes/tools that use this program (deduped). */
  usedBy: string[]
  /** OS-specific install guidance (always present; generic fallback otherwise). */
  install: InstallHint
}

/** The GET /tools payload: the host platform plus the tool catalog (unprobed). */
export interface ToolsResponse {
  /** process.platform of the engine host ('darwin' | 'linux' | 'win32' | …). */
  platform: string
  tools: ToolInfo[]
}

/** One tool's probed availability (GET /tools/probe?program=…). */
export interface ToolProbeResult {
  program: string
  installed: boolean
  version: string | null
}

/** The POST /tools/probe-batch request body. */
export interface ToolProbeBatchRequest {
  /** A saved backend id, or omitted/'local' for the engine host itself. */
  backendId?: string
  /** The programs to check. */
  programs: string[]
}

/** The POST /tools/probe-batch payload: one row per requested program. */
export interface ToolProbeBatchResponse {
  /** Echoes the probed connection ('local' when the engine host was probed). */
  backendId: string
  results: ToolProbeResult[]
  /**
   * Set when the CONNECTION failed rather than the tools being absent. `results`
   * is empty in that case, so the UI never reads an unreachable host as a
   * catalog of missing tools.
   */
  error?: string
}

export interface ToolRoutesDeps {
  /** Provide the manifest list (bundled + custom). Required. */
  manifests: () => ToolManifest[]
  /** Override the availability probe (tests). Defaults to the PATH probe. */
  probe?: AgentProbe
  /** The user's saved backend profiles. Defaults to none (local only). */
  backends?: () => BackendProfile[]
  /** Override the ssh/docker spawner (tests). Defaults to the real spawner. */
  run?: RunFn
}

/**
 * Collect the unique `command.program` values across the manifests, each with
 * the sorted, de-duplicated list of node names that use it.
 */
function collectPrograms(manifests: ToolManifest[]): Map<string, Set<string>> {
  const byProgram = new Map<string, Set<string>>()
  for (const m of manifests) {
    const program = m.command.program
    if (program === '') continue
    const names = byProgram.get(program) ?? new Set<string>()
    names.add(m.name)
    byProgram.set(program, names)
  }
  return byProgram
}

/**
 * A bare program name, as a manifest names one: no path, so a probe can only
 * run what PATH resolves, and no leading '-', so it cannot pose as an option.
 */
export function isProgramName(program: string): boolean {
  return /^[A-Za-z0-9_+.][A-Za-z0-9_+.-]*$/.test(program) && program !== '.' && program !== '..'
}

const probeBatchSchema = z.object({
  programs: z.array(z.string()).transform((list) => list.filter(isProgramName)).refine((list) => list.length > 0),
  backendId: z.string().min(1).optional(),
})

/**
 * Bearer-guarded tool routes. `GET /tools` returns the tool CATALOG without
 * probing (so the page renders instantly), and `GET /tools/probe?program=<p>`
 * checks one program's availability — the client fires one per tool so each
 * badge resolves on its own (same progressive pattern as the Agents page).
 */
export function toolRoutes(deps: ToolRoutesDeps): Hono {
  const app = new Hono()
  const probe = deps.probe ?? defaultProbe
  const backends = deps.backends ?? ((): BackendProfile[] => [])
  const run = deps.run ?? spawnRun

  app.get('/tools', (c) => {
    const byProgram = collectPrograms(deps.manifests())
    const tools = [...byProgram.entries()]
      .map(([program, names]): ToolInfo => ({
        program,
        usedBy: [...names].sort((a, b) => a.localeCompare(b)),
        install: toolInstallHint(program),
      }))
      .sort((a, b) => a.program.localeCompare(b.program))
    return c.json({ platform: process.platform, tools } satisfies ToolsResponse)
  })

  app.get('/tools/probe', async (c) => {
    const program = c.req.query('program') ?? ''
    if (!isProgramName(program)) return c.json({ error: 'program required' }, 400)
    const result = await probe(program)
    return c.json({ program, installed: result.installed, version: result.version } satisfies ToolProbeResult)
  })

  // Probe many programs at once, optionally on a saved connection. The local
  // catalog keeps its per-tool GET (badges resolve progressively); a remote
  // catalog comes back as one batch because the round trip is the expensive part.
  app.post('/tools/probe-batch', async (c) => {
    const parsed = probeBatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'programs required' }, 400)
    const { programs } = parsed.data
    const backendId = parsed.data.backendId ?? 'local'
    if (backendId === 'local') {
      const results = await Promise.all(
        programs.map(async (program): Promise<ToolProbeResult> => {
          const r = await probe(program)
          return { program, installed: r.installed, version: r.version }
        }),
      )
      return c.json({ backendId, results } satisfies ToolProbeBatchResponse)
    }

    const profile = backends().find((p) => p.id === backendId)
    if (profile === undefined) return c.json({ error: 'unknown backend' }, 404)
    // A saved profile of kind 'local' runs on this machine, so it takes the
    // direct path too rather than shelling out through a launcher.
    if (profile.kind === 'local') {
      const results = await Promise.all(
        programs.map(async (program): Promise<ToolProbeResult> => {
          const r = await probe(program)
          return { program, installed: r.installed, version: r.version }
        }),
      )
      return c.json({ backendId, results } satisfies ToolProbeBatchResponse)
    }

    const { rows, error } = await probeBackendTools(profile, programs, run)
    if (error !== undefined) return c.json({ backendId, results: [], error } satisfies ToolProbeBatchResponse)
    return c.json({ backendId, results: rows } satisfies ToolProbeBatchResponse)
  })

  return app
}
