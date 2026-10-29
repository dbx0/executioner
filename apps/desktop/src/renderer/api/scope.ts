import type { AxiosInstance } from 'axios'
import type { Rejudge } from './targets.js'

/** A scope rule the agent proposed, not yet saved. */
export interface ScopeRuleDraft {
  effect: 'include' | 'exclude'
  pattern: string
  note?: string
}

/** A target the agent proposed, not yet saved. */
export interface TargetDraft {
  kind: string
  value: string
}

/** What a propose-mode parse collected for the operator to review. */
export interface ScopeProposal {
  rules: ScopeRuleDraft[]
  targets: TargetDraft[]
}

export interface ScopeApplyResult extends Rejudge {
  rulesAdded: number
  targetsAdded: number
}

export interface ScopeParseInput {
  scope: string
  /** The agent to drive the parse (default agent); falls back to code parsing. */
  agent?: string
  /** The operator's raw program notes. When given, the same run tidies them into
   *  HUNT.md's Program section instead of leaving the paste as typed. */
  description?: string
  /** Collect the rules and targets for review instead of saving them. */
  propose?: boolean
}

export const scopeApi = (client: AxiosInstance) => ({
  /** Kick off a scope parse; returns the runId whose progress streams over /events. */
  parse: (input: ScopeParseInput) =>
    client.post<{ runId: string }>('/scope/parse', input).then((r) => r.data),
  /** Save a reviewed proposal: the rules, then the targets, then one re-judge. */
  apply: (proposal: ScopeProposal) =>
    client.post<ScopeApplyResult>('/scope/apply', proposal).then((r) => r.data),
})
