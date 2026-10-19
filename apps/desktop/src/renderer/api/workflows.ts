import type { AxiosInstance } from 'axios'
import type { Graph } from '../lib/graph-types.js'

export interface WorkflowSummary {
  id: string
  name: string
  updated_at: string
}

export const workflowsApi = (client: AxiosInstance) => ({
  list: () => client.get<WorkflowSummary[]>('/workflows').then((r) => r.data),
  get: (id: string) => client.get<{ id: string; name: string; graph: Graph }>(`/workflows/${id}`).then((r) => r.data),
  create: (name: string, graph: Graph) => client.post<{ id: string }>('/workflows', { name, graph }).then((r) => r.data),
  update: (id: string, name: string, graph: Graph) => client.put(`/workflows/${id}`, { name, graph }).then((r) => r.data),
  remove: (id: string, keepHistory = false) =>
    client.delete(`/workflows/${id}${keepHistory ? '?keepHistory=true' : ''}`).then((r) => r.data),
  duplicate: (id: string) => client.post<{ id: string; name: string }>(`/workflows/${id}/duplicate`, {}).then((r) => r.data),
})
