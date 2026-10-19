import type { AxiosInstance } from 'axios'

/** Aggregated usage for one Claude Code agent session (mirrors the engine's
 *  /usage response). Tokens are cumulative over the transcript; context is the
 *  last turn's prompt against the model's window; block is the rolling 5h window. */
export interface SessionUsage {
  model: string | null
  turnCount: number
  firstTimestamp: string | null
  lastTimestamp: string | null
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cacheWrite1h: number
    total: number
  }
  costUsd: number | null
  context: { used: number; limit: number; percent: number }
  block: {
    startedAt: number
    endsAt: number
    isActive: boolean
    tokens: number
    costUsd: number | null
  } | null
}

export const usageApi = (client: AxiosInstance) => ({
  /** Usage for one claude session id (the transcript filename stem), or — when
   *  no id is given — the engagement's most recent transcript (the current AI). */
  get: (session?: string) =>
    client
      .get<SessionUsage>('/usage', session !== undefined && session !== '' ? { params: { session } } : {})
      .then((r) => r.data),
})
