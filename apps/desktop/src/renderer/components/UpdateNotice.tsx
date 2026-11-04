import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { ArrowUpCircle, X } from 'lucide-react'
import type { UpdateInfo } from '../../main/update.js'
import { Button } from './ui/button.js'
import { errorFields, rlog } from '../lib/log.js'

type Phase =
  | { kind: 'available' }
  | { kind: 'downloading'; received: number; total: number | null }
  | { kind: 'ready' }
  | { kind: 'restarting' }

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Bottom-right card shown on startup when a newer release is out. When this
 * copy came from the install scripts, Update downloads the release in the
 * background with a progress bar, then offers a restart that installs it (the
 * app quits and reopens on the new version). Otherwise it opens the release page.
 */
export function UpdateNotice(): JSX.Element | null {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'available' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // Absent in tests and older preloads.
    const check = (window.executioner as Partial<Window['executioner']> | undefined)?.checkForUpdate
    if (check === undefined) return
    check()
      .then((info) => {
        if (live) setUpdate(info)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (phase.kind !== 'downloading') return
    return window.executioner.onUpdateProgress(({ received, total }) => {
      setPhase((p) => (p.kind === 'downloading' ? { kind: 'downloading', received, total } : p))
    })
  }, [phase.kind])

  if (update === null || dismissed) return null

  const onUpdate = (): void => {
    if (!update.canInstall) {
      window.open(update.url, '_blank')
      return
    }
    setPhase({ kind: 'downloading', received: 0, total: null })
    setError(null)
    window.executioner
      .downloadUpdate()
      .then(() => setPhase({ kind: 'ready' }))
      .catch(() => {
        setPhase({ kind: 'available' })
        setError('The download failed. Try again or get it from the release page.')
      })
  }

  const onRestart = (): void => {
    setPhase({ kind: 'restarting' })
    setError(null)
    window.executioner.installUpdate().catch((e: unknown) => {
      rlog.error('update', 'Could not start the update install', errorFields(e))
      setPhase({ kind: 'ready' })
      setError('Could not start the update. Try again or download it from the release page.')
    })
  }

  const busy = phase.kind === 'downloading' || phase.kind === 'restarting'
  const percent =
    phase.kind === 'downloading' && phase.total !== null && phase.total > 0
      ? Math.min(100, Math.round((phase.received / phase.total) * 100))
      : null

  let message: string
  if (phase.kind === 'downloading') message = `Downloading Executioner ${update.latest}...`
  else if (phase.kind === 'ready') message = 'The update is downloaded. Restart Executioner to apply it.'
  else if (phase.kind === 'restarting') message = 'Installing the update. Executioner will reopen when it is done.'
  else message = 'Update now to get the latest features and bug fixes.'

  return (
    <div
      role="dialog"
      aria-label="Update available"
      className="fixed bottom-9 right-4 z-[60] w-[320px] animate-zoom-in rounded-lg border border-border bg-popover p-4 text-foreground shadow-floating"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        disabled={busy}
        className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
      >
        <X className="size-3.5" />
      </button>
      <div className="flex gap-3 pr-5">
        <ArrowUpCircle className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Executioner {update.latest} is out</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{message}</p>
          {phase.kind === 'downloading' && (
            <div className="mt-2.5">
              <div
                role="progressbar"
                aria-label="Update download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
                className="h-1.5 overflow-hidden rounded-full bg-surface-2"
              >
                <div
                  className={
                    percent === null
                      ? 'h-full w-1/3 animate-pulse rounded-full bg-primary'
                      : 'h-full rounded-full bg-primary transition-[width] duration-200'
                  }
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </div>
              <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
                {phase.total !== null
                  ? `${megabytes(phase.received)} of ${megabytes(phase.total)} (${percent ?? 0}%)`
                  : megabytes(phase.received)}
              </p>
            </div>
          )}
          {error !== null && <p className="mt-1 text-[13px] text-destructive">{error}</p>}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {phase.kind === 'ready' ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
              Later
            </Button>
            <Button size="sm" onClick={onRestart}>
              Restart to update
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onUpdate} disabled={busy}>
            {phase.kind === 'downloading' ? 'Downloading...' : phase.kind === 'restarting' ? 'Restarting...' : 'Update'}
          </Button>
        )}
      </div>
    </div>
  )
}
