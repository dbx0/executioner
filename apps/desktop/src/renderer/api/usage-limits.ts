import type { AxiosInstance } from 'axios'

/** One normalized rate-limit window: percent consumed (0–100) + reset time. */
export interface LimitWindow {
  percent: number
  /** Unix ms timestamp when the window resets, or null if unknown. */
  resetsAt: number | null
}

/** Per-provider account rate limits (mirrors the engine's /usage/limits row). */
export interface ProviderLimits {
  provider: 'claude' | 'codex'
  five_hour: LimitWindow | null
  weekly: LimitWindow | null
  fable: LimitWindow | null
  plan: string | null
  /** Human-readable error ("Refresh failed"), null when the row is healthy. */
  error: string | null
}

export interface UsageLimits {
  claude: ProviderLimits
  codex: ProviderLimits
  updatedAt: number
}

export const usageLimitsApi = (client: AxiosInstance) => ({
  /** Account rate-limit windows for the local AI providers (Claude, Codex).
   *  Pass `refresh` to bypass the engine's short cache (a manual Retry). */
  get: (refresh = false) =>
    client
      .get<UsageLimits>('/usage/limits', refresh ? { params: { refresh: '1' } } : {})
      .then((r) => r.data),
})
