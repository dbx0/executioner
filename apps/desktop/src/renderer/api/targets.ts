import type { AxiosInstance } from 'axios'
import type { Finding } from './findings.js'

export type ScopeStatus = 'in' | 'out' | 'unknown'

export interface TargetNode {
  id: string
  kind: string
  value: string
  /** Registrable domain the asset sits under; null for an ip or a network. */
  apex: string | null
  parentId: string | null
  source: string
  /** Verdict against the engagement's scope rules. */
  scopeStatus: ScopeStatus
  /** Why it got that verdict, in words. */
  scopeReason: string
  children: TargetNode[]
}

/** What re-judging the target tree after a boundary edit produced. */
export interface Rejudge {
  rejudged: number
  inScope: number
  outOfScope: number
}

export interface ScopeRule {
  id: string
  effect: 'include' | 'exclude'
  pattern: string
  note: string
  source: string
  createdAt: string
}

export interface TargetSummary {
  id: string
  kind: string
  value: string
}

export interface TargetFact {
  id: string
  targetId: string
  kind: string
  executionId: string | null
  nodeId: string | null
  collectedAt: string
  data: Record<string, unknown>
}

export interface TargetDetail {
  id: string
  kind: string
  value: string
  apex: string | null
  parentId: string | null
  source: string
  scopeStatus: ScopeStatus
  scopeReason: string
  firstSeen: string
  lastSeen: string
  facts: TargetFact[]
  /** What has been proved against this asset, worst first. */
  findings: Finding[]
}

export interface ScreenshotItem {
  factId: string
  nodeId: string | null
  executionId: string | null
  collectedAt: string
  url?: string
  dataUrl: string
}

export const targetsApi = (client: AxiosInstance) => ({
  tree: () => client.get<TargetNode[]>('/targets/tree').then((r) => r.data),
  list: () => client.get<TargetSummary[]>('/targets').then((r) => r.data),
  get: (id: string) => client.get<TargetDetail>(`/targets/${id}`).then((r) => r.data),
  screenshots: (id: string) =>
    client.get<ScreenshotItem[]>(`/targets/${id}/screenshots`).then((r) => r.data),
  create: (input: { kind: string; value: string; source?: string; parentId?: string | null }) =>
    client.post('/targets', input).then((r) => r.data),
  update: (id: string, patch: { kind?: string; value?: string }) =>
    client.patch(`/targets/${id}`, patch).then((r) => r.data),
  remove: (id: string) => client.delete<{ ok: boolean; removed: number }>(`/targets/${id}`).then((r) => r.data),

  /** The engagement boundary every target write is judged against. */
  scopeRules: () => client.get<ScopeRule[]>('/scope/rules').then((r) => r.data),
  addScopeRule: (input: { effect: 'include' | 'exclude'; pattern: string; note?: string }) =>
    client.post<{ rule: ScopeRule } & Rejudge>('/scope/rules', input).then((r) => r.data),
  updateScopeRule: (
    id: string,
    patch: { effect?: 'include' | 'exclude'; pattern?: string; note?: string },
  ) => client.patch<{ rule: ScopeRule } & Rejudge>(`/scope/rules/${id}`, patch).then((r) => r.data),
  removeScopeRule: (id: string) =>
    client.delete<{ ok: boolean } & Rejudge>(`/scope/rules/${id}`).then((r) => r.data),
})
