import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { SessionInfo } from '../../main/logging/session-log.js'
import { Button } from './ui/button.js'
import { errorFields, rlog } from '../lib/log.js'

/**
 * Bottom-right card shown on startup when the previous session ended without a
 * clean shutdown. Export logs saves that session's log for a bug report.
 */
export function CrashNotice(): JSX.Element | null {
  const [crash, setCrash] = useState<SessionInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    // Absent in tests and older preloads.
    const log = (window.executioner as Partial<Window['executioner']> | undefined)?.log
    if (log?.previousCrash === undefined) return
    log
      .previousCrash()
      .then((s) => {
        if (live) setCrash(s)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (crash === null || dismissed) return null

  const onExport = (): void => {
    setBusy(true)
    window.executioner.log
      .exportLogs({ sessionId: crash.id, includeTargets: false, includeAllSessions: false })
      .then((res) => {
        if ('saved' in res) setDismissed(true)
      })
      .catch((e: unknown) => rlog.error('logs', 'Log export failed', errorFields(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div
      role="dialog"
      aria-label="Unexpected close"
      className="fixed bottom-9 left-4 z-[60] w-[320px] animate-zoom-in rounded-lg border border-border bg-popover p-4 text-foreground shadow-floating"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
      <div className="flex gap-3 pr-5">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-warning" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Executioner closed unexpectedly last time.</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Export its logs to include them in a bug report.</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={onExport} disabled={busy}>
          Export logs
        </Button>
      </div>
    </div>
  )
}
