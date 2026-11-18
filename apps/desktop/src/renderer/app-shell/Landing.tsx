import type { JSX } from 'react'
import { FolderOpen, FolderPlus } from 'lucide-react'
import { useApp } from '../store.js'
import { Button } from '../components/ui/button.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Spinner } from '../components/ui/spinner.js'
import logoUrl from '../assets/logo.png'

export function Landing(): JSX.Element {
  const openNewEngagement = useApp((s) => s.openNewEngagement)
  const recents = useApp((s) => s.recents)
  const busy = useApp((s) => s.busy)
  const error = useApp((s) => s.error)

  return (
    <div className="relative flex h-full w-full items-center justify-center p-8">
      {/* There is no title bar, so this strip is what drags the window from the landing page. */}
      <div aria-hidden className="app-drag absolute inset-x-0 top-0 h-[52px]" />
      <GlassPanel className="flex w-full max-w-md flex-col items-center gap-6 px-8 py-10 text-center">
        <img
          src={logoUrl}
          alt="Executioner"
          className="size-20 rounded-[22px] shadow-floating"
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

        <div className="flex flex-wrap items-center justify-center gap-2" aria-busy={busy}>
          <Button disabled={busy} onClick={() => openNewEngagement('open')}>
            {busy ? <Spinner /> : <FolderOpen className="size-4" strokeWidth={1.75} />}
            Open engagement
          </Button>
          <Button variant="glass" disabled={busy} onClick={() => openNewEngagement()}>
            <FolderPlus className="size-4" strokeWidth={1.75} />
            New engagement
          </Button>
        </div>

        {error !== null && (
          <p role="alert" className="max-w-sm text-xs text-destructive">{error}</p>
        )}

        <p className="text-[11px] text-tertiary-foreground">
          An engagement is a folder on disk with its own targets, workflows and evidence.
        </p>
      </GlassPanel>
    </div>
  )
}
