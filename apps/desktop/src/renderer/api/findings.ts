import type { AxiosInstance } from 'axios'

/** Worst first — the order the list is shown in. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const STATUSES = ['open', 'confirmed', 'false_positive', 'discarded', 'fixed'] as const
export type FindingStatus = (typeof STATUSES)[number]

export interface Finding {
  id: string
  title: string
  severity: string
  status: string
  description: string
  details: string
  targetId: string | null
  /** workflow | agent | manual — what put it here. */
  source: string
  executionId: string | null
  nodeId: string | null
  evidencePath: string | null
  createdAt: string
  updatedAt: string
}

/** The fields a person can set from the page. */
export interface FindingInput {
  title: string
  severity: string
  status?: string
  description?: string
  details?: string
  targetId?: string | null
}

export const findingsApi = (client: AxiosInstance) => ({
  list: (filter: { status?: string; severity?: string; targetId?: string } = {}) =>
    client.get<Finding[]>('/findings', { params: filter }).then((r) => r.data),
  get: (id: string) => client.get<Finding>(`/findings/${id}`).then((r) => r.data),
  create: (body: FindingInput) => client.post<Finding>('/findings', body).then((r) => r.data),
  update: (id: string, body: Partial<FindingInput>) =>
    client.patch<Finding>(`/findings/${id}`, body).then((r) => r.data),
  remove: (id: string) => client.delete(`/findings/${id}`).then((r) => r.data),
  /** Write the (optionally filtered) findings to a Markdown file in the engagement. */
  report: (filter: { status?: string; severity?: string; targetId?: string } = {}) =>
    client
      .post<{ path: string; relativePath: string; count: number }>('/findings/report', null, { params: filter })
      .then((r) => r.data),
})

/** Human label for a status value. */
export function statusLabel(status: string): string {
  return status === 'false_positive' ? 'False positive' : status.charAt(0).toUpperCase() + status.slice(1)
}
