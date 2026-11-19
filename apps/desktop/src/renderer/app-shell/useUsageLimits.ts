import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.js'
import { usageLimitsApi, type UsageLimits } from '../api/usage-limits.js'

type UsageApi = ReturnType<typeof usageLimitsApi>

/** Poll cadence for account rate limits, in ms. Limits move slowly. */
export const USAGE_POLL_MS = 60_000

export interface UsageLimitsState {
  /** The last limits the engine returned, or null before the first answer. */
  limits: UsageLimits | null
  /** A request is in flight (the first one, a poll or a manual refresh). */
  isFetching: boolean
  /** The first request has not settled yet, so there is nothing to show but a loader. */
  isLoading: boolean
  /** Fetch again now and restart the poll. */
  refresh: () => void
}

/**
 * The account rate limits of the active engine, polled slowly. A failed poll
 * keeps the last value: the engine may be restarting or be an older build.
 */
export function useUsageLimits(): UsageLimitsState {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : usageLimitsApi(client)), [client])
  // What the last settled request answered, tagged with the engine it asked, so
  // another engagement's numbers never show while the new engine is still loading.
  const [answer, setAnswer] = useState<{ api: UsageApi; limits: UsageLimits | null } | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (api === null) return
    let cancelled = false
    const load = (): void => {
      setIsFetching(true)
      api
        .get()
        .then((l) => {
          if (!cancelled) setAnswer({ api, limits: l })
        })
        .catch(() => {
          // Engine restarting or older build: keep the last value this engine gave.
          if (!cancelled) setAnswer((prev) => (prev?.api === api ? prev : { api, limits: null }))
        })
        .finally(() => {
          if (!cancelled) setIsFetching(false)
        })
    }
    load()
    const timer = setInterval(load, USAGE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [api, reloadKey])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])
  const current = api !== null && answer?.api === api ? answer : null
  return { limits: current?.limits ?? null, isFetching, isLoading: api !== null && current === null, refresh }
}
