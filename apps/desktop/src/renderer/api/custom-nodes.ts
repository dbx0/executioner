import type { AxiosInstance } from 'axios'
import type { EngineParamSpec } from './nodes.js'

/** The emit (output-parsing) config of a tool manifest. */
export interface EmitSpec {
  parser: 'json' | 'regex' | 'file'
  source?: 'stdout' | 'stderr'
  records?: string
  pattern?: string
  path?: string
  format?: 'json' | 'jsonl'
}

/** A custom node IS a ToolManifest authored by the user and stored in the project. */
export interface CustomNode {
  id: string
  name: string
  description: string
  category: string
  accepts: string[]
  params: Record<string, EngineParamSpec>
  command: { program: string; args: string[]; timeout_ms: number }
  emit: EmitSpec
}

/** The subset the editor sends; the engine fills defaults (args, timeout_ms, emit fields). */
export interface CustomNodeInput {
  id: string
  name: string
  description: string
  category: string
  accepts: string[]
  params?: Record<string, EngineParamSpec>
  command: { program: string; args?: string[]; timeout_ms?: number }
  emit: EmitSpec
}

export const customNodesApi = (client: AxiosInstance) => ({
  list: () => client.get<CustomNode[]>('/custom-nodes').then((r) => r.data),
  create: (body: CustomNodeInput) => client.post<CustomNode>('/custom-nodes', body).then((r) => r.data),
  update: (id: string, body: CustomNodeInput) =>
    client.put<CustomNode>(`/custom-nodes/${id}`, body).then((r) => r.data),
  remove: (id: string) => client.delete(`/custom-nodes/${id}`).then((r) => r.data),
})
