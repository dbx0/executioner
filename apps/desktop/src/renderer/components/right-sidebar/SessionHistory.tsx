import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Bot, RotateCw } from 'lucide-react'
import { useApp } from '../../store.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import { sessionsApi, type SessionSummary } from '../../api/sessions.js'
import { Button } from '../ui/button.js'
import { ScrollArea } from '../ui/scroll-area.js'

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
      <div className="grid h-full place-items-center px-3 text-center text-[12.5px] text-muted-foreground">
        Open an engagement
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 items-center justify-between px-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Sessions
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Refresh agent sessions"
        >
          <RotateCw className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

      {loading && sessions.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] text-muted-foreground">Loading…</p>
      ) : error !== null ? (
        <p className="px-2.5 py-1 text-[12px] text-status-error">{error}</p>
      ) : sessions.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] text-muted-foreground">No agent sessions</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
          <div className="flex flex-col gap-0.5">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2"
              >
                <Bot className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-muted-foreground">{session.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'} ·{' '}
                    {relativeTime(session.modifiedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
