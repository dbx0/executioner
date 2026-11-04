import type { Project } from '@exe/project'
import type { BackendProfile } from '@exe/protocol'

/**
 * Resolve the backend a run should use into a saved profile (or `undefined` for
 * local). Shared by the MCP `run_workflow` tool and the Scheduler so both pick a
 * backend the same way the HTTP run route does:
 *
 * - An explicit id that is not `local` must name a saved profile.
 * - No explicit id falls back to the engagement's default backend profile id,
 *   which must resolve too when it is set.
 * - `local`, an empty string, or nothing set means local execution.
 *
 * An id that does not resolve is an error, never a silent fall back to local:
 * a scheduled scan the operator pointed at a remote host must not quietly start
 * running on this machine instead.
 */
export function resolveRunBackend(project: Project, backendProfileId?: string | null): BackendProfile | undefined {
  const requested = backendProfileId ?? project.config.defaultBackendProfileId
  if (requested === undefined || requested === '' || requested === 'local') return undefined
  const profile = project.backends.get(requested)
  if (profile === undefined) throw new Error(`unknown backend profile: ${requested}`)
  return profile
}
