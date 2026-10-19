import type { AxiosInstance } from 'axios'

/** UI/metadata hints the engine may attach to any param. */
export interface ParamMeta {
  label?: string
  description?: string
  required?: boolean
  warning?: string
  /** Example text shown inside an empty field. */
  placeholder?: string
}

/** A manifest param as the engine serves it under GET /api/nodes (a record keyed by name). */
export type EngineParamSpec =
  | ({ type: 'string'; default?: string; ui?: 'text' | 'textarea' | 'code' } & ParamMeta)
  | ({ type: 'number'; default?: number } & ParamMeta)
  | ({ type: 'bool'; default?: boolean } & ParamMeta)
  | ({ type: 'enum'; values: string[]; default?: string } & ParamMeta)

export interface NodeListing {
  id: string
  name: string
  category: string
  description: string
  /** The CLI binary this node invokes — the key into the tool probe results. */
  program?: string
  accepts: string[]
  params: Record<string, EngineParamSpec>
  /** Fields this node exposes downstream (as {{ nodes.<id>.<field> }}). */
  outputs?: string[]
  /** Not currently served by the engine; reserved for a future binary-availability probe. */
  available?: boolean
}

/** A command as the engine would execute it: no shell, one element per arg. */
export interface Argv {
  program: string
  args: string[]
}

export const nodesApi = (client: AxiosInstance) => ({
  list: () => client.get<NodeListing[]>('/nodes').then((r) => r.data),
  /** The argv a run would execute; rejects with the reason when it cannot be built yet. */
  preview: (id: string, body: { targetId?: string; params: Record<string, unknown> }) =>
    client.post<Argv>(`/nodes/${id}/preview`, body).then((r) => r.data),
  run: (
    id: string,
    body: { targetId: string; params?: Record<string, unknown>; backendProfileId?: string },
  ) =>
    client
      .post<{ executionId: string }>('/executions', {
        nodeId: id,
        targetId: body.targetId,
        params: body.params ?? {},
        ...(body.backendProfileId !== undefined ? { backendProfileId: body.backendProfileId } : {}),
      })
      .then((r) => r.data),
})
