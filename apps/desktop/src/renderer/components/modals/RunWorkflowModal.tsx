import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Search, X, Globe, Network, Boxes, Link2 } from 'lucide-react'
import { useApp } from '../../store.js'
import { targetsApi, type TargetSummary } from '../../api/targets.js'
import { backendsApi, type BackendProfile } from '../../api/backends.js'
import { executionsApi } from '../../api/executions.js'
import { loadRunBackend, saveRunBackend } from '../../store/persistence.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { Select, type SelectOption } from '../ui/select.js'
import { cn } from '../../lib/utils.js'

const KIND_ICON: Record<string, typeof Globe> = {
  domain: Globe,
  subdomain: Globe,
  ip: Network,
  cidr: Boxes,
  url: Link2,
}

const MAX_RESULTS = 100

/**
 * Run a saved workflow: pick the target with a search box (not a dropdown) and
 * where it runs, then fire the run. The run is kicked off and the modal closes so
 * the caller's executions view shows it live.
 *
 * The backend matters as much as the target: omitting it runs every tool on this
 * machine, which for a recon workflow usually means each one failing to spawn.
 * The choice is shared with the canvas run panel and remembered per engagement.
 */
export function RunWorkflowModal({
  workflowId,
  name,
  onClose,
  onRan,
}: {
  workflowId: string
  name: string
  onClose: () => void
  onRan?: () => void
}): JSX.Element {
  const client = useApp((s) => s.client)!
  const activeRoot = useApp((s) => s.activeRoot)
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [backendId, setBackendId] = useState<string>(() => loadRunBackend(activeRoot))
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void targetsApi(client)
      .list()
      .then((list) => alive && setTargets(list))
      .catch(() => {})
    void backendsApi(client)
      .list()
      .then((list) => {
        if (!alive) return
        setProfiles(list)
        // A remembered backend whose profile is gone would silently run locally.
        setBackendId((cur) => (cur !== 'local' && !list.some((p) => p.id === cur) ? 'local' : cur))
      })
      .catch(() => {})
    inputRef.current?.focus()
    return () => {
      alive = false
    }
  }, [client])

  const chooseBackend = (id: string): void => {
    setBackendId(id)
    saveRunBackend(activeRoot, id)
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q === '' ? targets : targets.filter((t) => t.value.toLowerCase().includes(q) || t.kind.includes(q))
    return matched.slice(0, MAX_RESULTS)
  }, [targets, query])

  const run = (): void => {
    if (selectedId === undefined) return
    setRunning(true)
    // Fire-and-forget: the run streams into the executions view; don't block the
    // modal on a long workflow.
    void executionsApi(client)
      .runWorkflow(workflowId, {
        targetId: selectedId,
        ...(backendId !== 'local' ? { backendProfileId: backendId } : {}),
      })
      .catch(() => {})
    onRan?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[72vh] w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="truncate text-[14px] font-medium">Run “{name}”</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && selectedId === undefined && results[0] !== undefined) setSelectedId(results[0].id)
                  else if (e.key === 'Enter' && selectedId !== undefined) run()
                }}
                placeholder="Search targets…"
                className="h-9 pl-8 font-mono text-[13px]"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-1.5">
            {targets.length === 0 ? (
              <p className="px-2 py-3 text-[13px] text-muted-foreground">No targets yet. Add one on the Targets page.</p>
            ) : results.length === 0 ? (
              <p className="px-2 py-3 text-[13px] text-muted-foreground">No targets match “{query}”.</p>
            ) : (
              results.map((t) => {
                const Icon = KIND_ICON[t.kind] ?? Globe
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    onDoubleClick={() => {
                      setSelectedId(t.id)
                      run()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]',
                      t.id === selectedId
                        ? 'selected-surface'
                        : 'hover:bg-surface-2',
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{t.value}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{t.kind}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Run on</label>
          <Select
            value={backendId}
            onValueChange={chooseBackend}
            options={[
              { value: 'local', label: 'Local machine' },
              ...profiles.map((p): SelectOption => ({ value: p.id, label: `${p.name} (${p.kind})` })),
            ]}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={selectedId === undefined || running} onClick={run}>
            <Play className="size-4" strokeWidth={2} />
            Run
          </Button>
        </div>
      </div>
    </div>
  )
}
