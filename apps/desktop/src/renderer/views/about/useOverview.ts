import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import { overviewApi, type Overview } from '../../api/overview.js'
import { friendlyError } from '../../lib/api-error.js'

/** Live counts (runs, agents) go stale silently, so the page re-reads slowly. */
const POLL_MS = 60_000

export interface OverviewState {
  data: Overview | null
  /** True while a read the operator can see (first load, manual refresh) is in flight. */
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * The one `GET /project/overview` read behind the About page, kept fresh three
 * ways: on mount, on a slow timer, and silently whenever the engine reports a
 * change to something the page counts.
 */
export function useOverview(): OverviewState {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : overviewApi(client)), [client])

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const read = useCallback(
    async (silent = false) => {
      if (api === null) return
      if (!silent) setLoading(true)
      try {
        setData(await api.get())
        setError(null)
      } catch (e) {
        // A 404 here is the engine, not the request: an engagement still served by
        // an older engine has no /project/overview until it restarts.
        setError(friendlyError(e, (e as Error).message))
      } finally {
        // A silent refresh never started the spinner, so it must not stop one a
        // manual refresh still owns.
        if (!silent) setLoading(false)
      }
    },
    [api],
  )

  useEffect(() => {
    void read()
    const timer = setInterval(() => void read(), POLL_MS)
    return () => clearInterval(timer)
  }, [read])

  // Changes arrive as events; the timer only keeps the relative times ticking.
  useEngineChange(['targets', 'findings', 'scope', 'runs', 'sessions'], () => void read(true))

  const refresh = useCallback(() => void read(), [read])
  return { data, loading, error, refresh }
}
