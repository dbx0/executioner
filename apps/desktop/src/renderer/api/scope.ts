import type { AxiosInstance } from 'axios'

export interface ScopeParseInput {
  scope: string
  /** The agent to drive the parse (default agent); falls back to code parsing. */
  agent?: string
  /** The operator's raw program notes. When given, the same run tidies them into
   *  HUNT.md's Program section instead of leaving the paste as typed. */
  description?: string
}

export const scopeApi = (client: AxiosInstance) => ({
  /** Kick off a scope parse; returns the runId whose progress streams over /events. */
  parse: (input: ScopeParseInput) =>
    client.post<{ runId: string }>('/scope/parse', input).then((r) => r.data),
})
