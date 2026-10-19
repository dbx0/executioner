import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../../lib/api-error.js'
import { RotateCw } from 'lucide-react'
import { useApp } from '../../store.js'
import { executionsApi, type ExecutionSummary } from '../../api/executions.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { ScrollArea } from '../ui/scroll-area.js'

/** Status dot color, mirroring Sidebar.tsx's run idiom. */
function runDotClass(status: string): string {
  if (status === 'succeeded' || status === 'success') return 'bg-status-success'
  if (status === 'running') return 'bg-status-running animate-pulse'
  if (status === 'failed' || status === 'error') return 'bg-status-error'
  return 'bg-tertiary-foreground'
}

/** A short, local time from an ISO timestamp (empty if unparseable). */
function shortTime(iso: string | null): string {
  if (iso === null) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function ExecutionHistory(): JSX.Element {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : executionsApi(client)), [client])
  const [runs, setRuns] = useState<ExecutionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (api === null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .list()
      .then((list) => {
        if (cancelled) return
        setRuns(list)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(friendlyError(e, 'Couldn’t load executions.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, nonce])

  if (client === null) {
    return (
      <div className="grid h-full place-items-center px-3 text-center text-[12.5px] text-muted-foreground">
        Open an engagement
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 items-center justify-between px-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Executions
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Refresh executions"
        >
          <RotateCw className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

      {loading && runs.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] text-muted-foreground">Loading…</p>
      ) : error !== null ? (
        <p className="px-2.5 py-1 text-[12px] text-status-error">{error}</p>
      ) : runs.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] text-muted-foreground">No executions yet</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
          <div className="flex flex-col gap-0.5">
            {runs.map((r) => {
              const detail = r.targetId ?? shortTime(r.startedAt)
              return (
                <div
                  key={r.id}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] text-muted-foreground hover:bg-surface-2"
                >
                  <span className={cn('size-2 shrink-0 rounded-full', runDotClass(r.status))} />
                  <span className="truncate font-mono text-[11.5px]">{r.id.slice(0, 8)}</span>
                  {detail !== '' && (
                    <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
                  )}
                  <span className="ml-auto shrink-0 truncate text-[11px] capitalize text-muted-foreground">
                    {r.status}
                  </span>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
