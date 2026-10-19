import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useApp } from '../../store.js'
import { logsApi, type LogSource } from '../../api/logs.js'
import { Button } from '../../components/ui/button.js'
import { PageHeading } from './parts.js'

const SOURCE_LABEL: Record<LogSource, string> = {
  file: 'engine log file',
  events: 'recent engine events',
  empty: 'no logs yet',
}

/** Logs: recent engine log lines from the bearer-guarded /logs route. */
export function LogsSection(): JSX.Element {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : logsApi(client)), [client])
  const [lines, setLines] = useState<string[]>([])
  const [source, setSource] = useState<LogSource>('empty')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  const load = useCallback(() => {
    if (api === null) return
    setLoading(true)
    void api
      .recent()
      .then((res) => {
        setLines(res.lines)
        setSource(res.source)
        setError(null)
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  // Keep the newest line in view after a refresh.
  useEffect(() => {
    const el = preRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between">
        <PageHeading title="Logs" description="Recent engine activity for troubleshooting." />
        <Button variant="outline" size="sm" onClick={load} disabled={loading || api === null}>
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} strokeWidth={1.75} />
          Refresh
        </Button>
      </div>

      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Source: {SOURCE_LABEL[source]}
      </div>

      {error !== null ? (
        <p className="text-[12px] text-status-error">{error}</p>
      ) : (
        <pre
          ref={preRef}
          className="min-h-0 flex-1 overflow-auto scrollbar-sleek rounded-lg border border-border bg-surface-1 p-3 font-mono text-[12px] leading-relaxed text-foreground"
        >
          {lines.length === 0 ? (
            <span className="text-muted-foreground">No log lines yet. Engine activity will appear here.</span>
          ) : (
            lines.join('\n')
          )}
        </pre>
      )}
    </div>
  )
}
