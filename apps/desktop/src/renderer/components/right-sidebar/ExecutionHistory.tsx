import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../../lib/api-error.js'
import { useApp } from '../../store.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import { executionsApi, type ExecutionSummary } from '../../api/executions.js'
import { cn } from '../../lib/utils.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { Panel, PanelNote, PanelRefresh, PanelRow, PanelRowsSkeleton } from './panel-parts.js'

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

  // The list stays on screen while the refetch lands; the skeleton only shows when it is empty.
  useEngineChange(['runs'], () => setNonce((n) => n + 1))

  if (client === null) {
    return (
      <Panel title="Executions">
        <PanelNote fill>Open an engagement</PanelNote>
      </Panel>
    )
  }

  return (
    <Panel
      title="Executions"
      actions={<PanelRefresh label="Refresh executions" loading={loading} onClick={() => setNonce((n) => n + 1)} />}
    >
      {loading && runs.length === 0 ? (
        <PanelRowsSkeleton label="Loading executions" />
      ) : error !== null ? (
        <PanelNote tone="error">{error}</PanelNote>
      ) : runs.length === 0 ? (
        <PanelNote>No executions yet</PanelNote>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-1.5 pb-2">
          <div className="flex flex-col gap-0.5">
            {runs.map((r) => {
              const detail = r.targetId ?? shortTime(r.startedAt)
              return (
                <PanelRow
                  key={r.id}
                  icon={<span aria-hidden className={cn('mx-0.5 size-2 shrink-0 rounded-full', runDotClass(r.status))} />}
                  label={
                    <>
                      <span className="font-mono text-[11.5px]">{r.id.slice(0, 8)}</span>
                      {detail !== '' && <span className="ml-2 text-[11px] text-tertiary-foreground">{detail}</span>}
                    </>
                  }
                  trailing={<span className="shrink-0 text-[11px] capitalize">{r.status}</span>}
                />
              )
            })}
          </div>
        </ScrollArea>
      )}
    </Panel>
  )
}
