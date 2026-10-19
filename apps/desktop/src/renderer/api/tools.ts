import type { AxiosInstance } from 'axios'

/** OS-specific install guidance for one tool (mirrors the engine's InstallHint). */
export interface InstallHint {
  darwin?: string
  linux?: string
  windows?: string
  note?: string
  url?: string
}

/** One external tool in the catalog (mirrors the engine's /tools row, unprobed). */
export interface ToolInfo {
  /** The binary the node manifests invoke (`command.program`). */
  program: string
  /** The names of the nodes/tools that use this program (deduped). */
  usedBy: string[]
  /** OS-specific install guidance (always present). */
  install: InstallHint
}

/** The GET /tools payload: the engine host platform plus the tool catalog. */
export interface ToolsResponse {
  /** process.platform of the engine host ('darwin' | 'linux' | 'win32' | …). */
  platform: string
  tools: ToolInfo[]
}

/** One tool's probed availability (GET /tools/probe). */
export interface ToolProbeResult {
  program: string
  installed: boolean
  version: string | null
}

/** The POST /tools/probe-batch payload (mirrors the engine shape). */
export interface ToolProbeBatchResponse {
  /** The connection that was probed ('local' for the engine host). */
  backendId: string
  results: ToolProbeResult[]
  /**
   * Set when the CONNECTION failed rather than the tools being absent — with it,
   * `results` is empty and the page shows the link as unreachable.
   */
  error?: string
}

export const toolsApi = (client: AxiosInstance) => ({
  /** The tool catalog (fast, no probing) — render this immediately. */
  list: () => client.get<ToolsResponse>('/tools').then((r) => r.data),
  /** Probe one tool's CLI availability; the Tools page fires one per tool. */
  probe: (program: string) =>
    client.get<ToolProbeResult>('/tools/probe', { params: { program } }).then((r) => r.data),
  /**
   * Probe the whole catalog on one connection in a single request. Used for
   * saved SSH/Docker backends, where per-tool probing would cost one connection
   * (or one throwaway container) per tool.
   */
  probeBatch: (programs: string[], backendId?: string) =>
    client
      .post<ToolProbeBatchResponse>('/tools/probe-batch', {
        programs,
        ...(backendId !== undefined ? { backendId } : {}),
      })
      .then((r) => r.data),
})
