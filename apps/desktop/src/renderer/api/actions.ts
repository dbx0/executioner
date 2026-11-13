import type { AxiosInstance } from 'axios'

export type ActionKind = 'interval' | 'on_create'

/** Where an action lives: shared by every engagement, or this one's own. */
export type ActionScope = 'default' | 'engagement'

/** A trigger and what it runs: a workflow, or a single tool. Never both. */
export interface Action {
  id: string
  workflowId: string | null
  nodeType: string | null
  nodeParams: Record<string, unknown> | null
  targetId: string | null
  kind: ActionKind
  intervalSeconds: number | null
  targetKind: string | null
  /** A saved backend profile id to run on, or null for the engagement default. */
  backendProfileId: string | null
  /** on_create only: fire just for targets the scope rules include. */
  inScopeOnly: boolean
  enabled: boolean
  createdAt: string
}

/** A default, with whether this engagement has left it switched on. */
export type DefaultAction = Action & { enabledHere: boolean }

export interface ActionList {
  defaults: DefaultAction[]
  engagement: Action[]
}

export interface ActionInput {
  scope: ActionScope
  kind: ActionKind
  intervalSeconds?: number
  targetKind?: string
  targetId?: string
  workflowId?: string
  nodeType?: string
  nodeParams?: Record<string, unknown>
  backendProfileId?: string
  inScopeOnly?: boolean
}

export const actionsApi = (client: AxiosInstance) => ({
  list: () => client.get<ActionList>('/actions').then((r) => r.data),
  create: (body: ActionInput) => client.post<Action>('/actions', body).then((r) => r.data),
  setEnabled: (scope: ActionScope, id: string, enabled: boolean) =>
    client.patch(`/actions/${scope}/${id}`, { enabled }).then((r) => r.data as unknown),
  remove: (scope: ActionScope, id: string) => client.delete(`/actions/${scope}/${id}`).then((r) => r.data as unknown),
})
