import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { ArrowUpCircle, X } from 'lucide-react'
import type { UpdateInfo } from '../../main/update.js'
import { Button } from './ui/button.js'

/**
 * Bottom-right card shown on startup when a newer release is out. Update
 * installs in place when this copy came from the install scripts (the app quits
 * and reopens on the new version); otherwise it opens the release page.
 */
export function UpdateNotice(): JSX.Element | null {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
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

  if (update === null || dismissed) return null

  const onUpdate = (): void => {
    if (!update.canInstall) {
      window.open(update.url, '_blank')
      return
    }
    setInstalling(true)
    setError(null)
    window.executioner.installUpdate().catch(() => {
      setInstalling(false)
      setError('Could not start the update. Try again or download it from the release page.')
    })
  }

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
        disabled={installing}
        className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
      >
        <X className="size-3.5" />
      </button>
      <div className="flex gap-3 pr-5">
        <ArrowUpCircle className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <div className="min-w-0">
          <p className="text-sm font-medium">Executioner {update.latest} is out</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {installing
              ? 'Installing the update. Executioner will close and reopen when it is done.'
              : 'Update now to get the latest features and bug fixes.'}
          </p>
          {error !== null && <p className="mt-1 text-[13px] text-destructive">{error}</p>}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => window.open(update.url, '_blank')} disabled={installing}>
          Release notes
        </Button>
        <Button size="sm" onClick={onUpdate} disabled={installing}>
          {installing ? 'Updating...' : 'Update'}
        </Button>
      </div>
    </div>
  )
}
