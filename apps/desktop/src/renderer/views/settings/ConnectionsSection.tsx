import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { Container, Laptop, Pencil, Plug, Plus, Server, Trash2 } from 'lucide-react'
import { useApp } from '../../store.js'
import { backendsApi, type BackendKind, type BackendProfile } from '../../api/backends.js'
import { AddBackendModal } from '../../components/modals/BackendsDialog.js'
import { Button } from '../../components/ui/button.js'
import { PageHeading } from './parts.js'

function KindIcon({ kind }: { kind: BackendKind }): JSX.Element {
  const Icon = kind === 'docker' ? Container : kind === 'ssh' ? Server : Laptop
  return <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
}

function kindLabel(kind: BackendKind): string {
  return kind === 'docker' ? 'Docker' : kind === 'ssh' ? 'SSH' : 'Local'
}

/** One-line summary of where the backend runs. */
function summary(p: BackendProfile): string {
  if (p.kind === 'ssh') {
    const at = `${p.user ?? '?'}@${p.host ?? '?'}${p.port !== undefined ? `:${p.port}` : ''}`
    return p.workdir !== undefined && p.workdir !== '' ? `${at} · ${p.workdir}` : at
  }
  if (p.kind === 'docker') {
    return p.workdir !== undefined && p.workdir !== '' ? `${p.image ?? '?'} · ${p.workdir}` : p.image ?? '?'
  }
  return 'Runs on this machine'
}

/** A saved backend as a card with kind icon, summary, and edit/delete actions. */
function BackendCard({
  profile,
  onEdit,
  onDelete,
}: {
  profile: BackendProfile
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2">
          <KindIcon kind={profile.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{profile.name}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{kindLabel(profile.kind)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-xs" aria-label="Edit" onClick={onEdit}>
            <Pencil className="size-3.5 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete"
            className="hover:text-status-error"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
      <div className="truncate font-mono text-[11px] text-muted-foreground" title={summary(profile)}>
        {summary(profile)}
      </div>
    </div>
  )
}

/** The backends manager: cards for saved profiles + an "Add backend" modal. */
function BackendsManager({ client }: { client: AxiosInstance }): JSX.Element {
  const api = backendsApi(client)
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; profile: BackendProfile } | null>(null)

  const refresh = (): void => {
    void api
      .list()
      .then(setProfiles)
      .catch(() => {})
  }
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (id: string): void => {
    void api.remove(id).catch(() => {})
    setProfiles((ps) => ps.filter((p) => p.id !== id))
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Backends</div>
        <Button variant="outline" size="sm" onClick={() => setModal({ mode: 'new' })}>
          <Plus className="size-4" strokeWidth={2} />
          Add backend
        </Button>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-[13px] text-muted-foreground">No backends yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add an SSH host or Docker image to run commands somewhere other than this machine.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <BackendCard
              key={p.id}
              profile={p}
              onEdit={() => setModal({ mode: 'edit', profile: p })}
              onDelete={() => remove(p.id)}
            />
          ))}
        </div>
      )}

      {modal !== null && (
        <AddBackendModal
          client={client}
          {...(modal.mode === 'edit' ? { initial: modal.profile } : {})}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

/** Connections: the live engine link plus the SSH/Docker backend profiles. */
export function ConnectionsSection(): JSX.Element {
  const connection = useApp((s) => s.connection)
  const client = useApp((s) => s.client)

  return (
    <div>
      <PageHeading
        title="Connections"
        description="Where commands run: the local engine, and any SSH or Docker backends. Saved connections follow you into every engagement."
      />

      <div className="mb-6 flex items-center gap-3 rounded-lg border border-border p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2">
          <Plug className="size-4 text-muted-foreground" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Engine</div>
          <div className="text-xs text-muted-foreground">
            {connection === null ? 'Not connected' : 'Local loopback engine for this engagement.'}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-[12px] text-muted-foreground">
          {connection === null ? '—' : `127.0.0.1:${connection.port}`}
        </div>
      </div>

      {client === null ? (
        <p className="text-xs text-muted-foreground">Open an engagement to configure backends.</p>
      ) : (
        <BackendsManager client={client} />
      )}
    </div>
  )
}
