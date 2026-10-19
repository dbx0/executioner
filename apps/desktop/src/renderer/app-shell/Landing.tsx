import type { JSX } from 'react'
import { FolderOpen, FolderPlus } from 'lucide-react'
import { useApp } from '../store.js'
import { Button } from '../components/ui/button.js'
import logoUrl from '../assets/logo.png'

export function Landing(): JSX.Element {
  const openNewEngagement = useApp((s) => s.openNewEngagement)
  const recents = useApp((s) => s.recents)
  const busy = useApp((s) => s.busy)
  const error = useApp((s) => s.error)

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <img
          src={logoUrl}
          alt="Executioner"
          className="size-20 rounded-2xl shadow-floating"
          draggable={false}
        />
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Executioner</h1>
          <p className="text-sm text-muted-foreground">
            {recents.length === 0
              ? 'Open an engagement folder to get started.'
              : 'Open an engagement, or pick a recent one from the sidebar.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => openNewEngagement('open')}>
            <FolderOpen className="size-4" strokeWidth={1.75} />
            Open engagement
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => openNewEngagement()}>
            <FolderPlus className="size-4" strokeWidth={1.75} />
            New engagement
          </Button>
        </div>

        {error !== null && (
          <p className="max-w-sm text-xs text-destructive">{error}</p>
        )}

        <p className="text-[11px] text-muted-foreground">
          An engagement is a folder on disk with its own targets, workflows and evidence.
        </p>
      </div>
    </div>
  )
}
