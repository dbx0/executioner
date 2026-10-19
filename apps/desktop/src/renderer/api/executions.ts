import type { AxiosInstance } from 'axios'

export interface ExecutionSummary {
  id: string
  workflowId: string | null
  targetId: string | null
  status: string
  startedAt: string | null
  finishedAt: string | null
}

/** One node's persisted result, as the runs view renders it. */
export interface NodeOutputRow {
  nodeId: string
  status: string
  exitCode: number | null
  stdout: string
  stderr: string
  /** Rows the node parsed out — for built-ins this is the only result there is. */
  parsed: unknown
}

/**
 * One standalone run: an execution with no workflow behind it, as the Tools
 * page starts them. Carries enough to repeat the run verbatim.
 */
export interface StandaloneRun {
  id: string
  nodeId: string
  targetId: string | null
  /** The target's value at list time, or null when the target is gone. */
  targetValue: string | null
  status: string
  /** Where it ran: 'local', 'ssh' or 'docker'. */
  backend: string
  /** The saved connection it ran on, or null for this machine. */
  backendProfileId: string | null
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  params: Record<string, unknown>
}

export const executionsApi = (client: AxiosInstance) => ({
  list: () => client.get<ExecutionSummary[]>('/executions').then((r) => r.data),
  /** Recent standalone runs, newest first — the Tools page's history. */
  standalone: (limit?: number) =>
    client
      .get<StandaloneRun[]>('/executions/standalone', limit === undefined ? {} : { params: { limit } })
      .then((r) => r.data),
  get: (id: string) => client.get(`/executions/${id}`).then((r) => r.data),
  output: (id: string) =>
    client
      .get<NodeOutputRow[]>(`/executions/${id}/output`)
      .then((r) => r.data),
  runWorkflow: (
    workflowId: string,
    body: { targetId: string; testMode?: boolean; backendProfileId?: string; mode?: 'run' | 'step' },
  ) => client.post(`/workflows/${workflowId}/run`, body).then((r) => r.data),
  /** Stop a run: kills what it is running and settles it as cancelled. */
  cancel: (executionId: string) =>
    client.post<{ ok: boolean; status: string }>(`/executions/${executionId}/cancel`).then((r) => r.data),
  step: (executionId: string) => client.post(`/executions/${executionId}/step`).then((r) => r.data),
  resume: (executionId: string) => client.post(`/executions/${executionId}/resume`).then((r) => r.data),
})
