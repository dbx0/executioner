import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Bot } from 'lucide-react'
import { useApp } from '../../store.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import { sessionsApi, type SessionSummary } from '../../api/sessions.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { Panel, PanelNote, PanelRefresh, PanelRow, PanelRowsSkeleton } from './panel-parts.js'

/** A compact "n unit(s) ago" from an epoch-ms timestamp. */
function relativeTime(ms: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function SessionHistory(): JSX.Element {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : sessionsApi(client)), [client])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
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
        setSessions(list)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // A 404 means an older engine without this route is still running — a
        // restart picks it up. Show a friendly line instead of the raw axios error.
        const status = (e as { response?: { status?: number } })?.response?.status
        setError(status === 404 ? 'Restart the app to enable agent session history.' : 'Couldn’t load agent sessions.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, nonce])

  // The list stays on screen while the refetch lands; the skeleton only shows when it is empty.
  useEngineChange(['sessions'], () => setNonce((n) => n + 1))

  if (client === null) {
    return (
      <Panel title="Agent Sessions">
        <PanelNote fill>Open an engagement</PanelNote>
      </Panel>
    )
  }

  return (
    <Panel
      title="Agent Sessions"
      actions={<PanelRefresh label="Refresh agent sessions" loading={loading} onClick={() => setNonce((n) => n + 1)} />}
    >
      {loading && sessions.length === 0 ? (
        <PanelRowsSkeleton label="Loading agent sessions" detail />
      ) : error !== null ? (
        <PanelNote tone="error">{error}</PanelNote>
      ) : sessions.length === 0 ? (
        <PanelNote>No agent sessions</PanelNote>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-1.5 pb-2">
          <div className="flex flex-col gap-0.5">
            {sessions.map((session) => (
              <PanelRow
                key={session.id}
                icon={<Bot className="size-4 shrink-0" strokeWidth={1.75} />}
                label={session.title}
                detail={`${String(session.messageCount)} ${session.messageCount === 1 ? 'message' : 'messages'} · ${relativeTime(session.modifiedAt)}`}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </Panel>
  )
}
