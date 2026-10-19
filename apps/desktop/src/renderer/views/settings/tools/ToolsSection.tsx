import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { Container, Laptop, Loader2, RefreshCw, Server, Unplug } from 'lucide-react'
import { useApp } from '../../../store.js'
import { cn } from '../../../lib/utils.js'
import { Button } from '../../../components/ui/button.js'
import { toolsApi, type ToolInfo, type ToolProbeResult } from '../../../api/tools.js'
import { backendsApi, type BackendKind, type BackendProfile } from '../../../api/backends.js'
import { PageHeading } from '../parts.js'
import { ToolCard, type CardState } from './ToolCard.js'
import { InstallModal } from './InstallModal.js'

/** The id of the tab that probes the engine host itself. */
const LOCAL = 'local'

/** One tab: the engine host, or a saved connection. */
interface Tab {
  id: string
  label: string
  kind: BackendKind
  /** A one-line description of where this tab probes, for the install modal. */
  where: string
}

/** What we know about one tab's probe run. Absent entirely until first visited. */
interface TabState {
  /** True while a probe is in flight for this tab. */
  busy: boolean
  /** Programs still being probed — only the local tab resolves progressively. */
  pending: Set<string>
  probes: Record<string, ToolProbeResult>
  /** Set when the CONNECTION failed; tools are unknown rather than missing. */
  error: string | null
}

function kindIcon(kind: BackendKind): typeof Laptop {
  return kind === 'docker' ? Container : kind === 'ssh' ? Server : Laptop
}

/** One-line summary of where a backend runs (matches the Connections page). */
function summary(p: BackendProfile): string {
  if (p.kind === 'ssh') {
    const at = `${p.user ?? '?'}@${p.host ?? '?'}${p.port !== undefined ? `:${p.port}` : ''}`
    return p.workdir !== undefined && p.workdir !== '' ? `${at} · ${p.workdir}` : at
  }
  if (p.kind === 'docker') {
    return p.workdir !== undefined && p.workdir !== '' ? `${p.image ?? '?'} · ${p.workdir}` : p.image ?? '?'
  }
  return 'this machine'
}

/** The tab strip. Only rendered when there is more than one connection to show. */
function TabStrip({
  tabs,
  active,
  onSelect,
  missingFor,
}: {
  tabs: Tab[]
  active: string
  onSelect: (id: string) => void
  missingFor: (id: string) => number | null
}): JSX.Element {
  return (
    <div role="tablist" aria-label="Connection" className="mb-3 flex flex-wrap items-center gap-1 border-b border-border pb-1.5">
      {tabs.map((tab) => {
        const Icon = kindIcon(tab.kind)
        const missing = missingFor(tab.id)
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
              active === tab.id ? 'bg-surface-3 font-medium' : 'text-muted-foreground hover:bg-surface-2',
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            {tab.label}
            {missing !== null && missing > 0 && <span className="tabular-nums text-destructive">{missing}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Settings → Tools: the tool catalog (every external CLI the node manifests
 * invoke, deduped by binary) renders immediately, then each tool's badge
 * resolves as the engine probes that binary.
 *
 * With saved connections there is one tab per connection plus "This machine".
 * A tab probes only the first time you open it, and its results are cached, so
 * switching back is instant. The local tab probes per tool (badges resolve one
 * by one); a remote tab probes the whole catalog in ONE request, because the
 * round trip — an SSH connection or a throwaway container — is the cost, not
 * the individual check.
 */
function ToolsList({ client }: { client: AxiosInstance }): JSX.Element {
  const api = useMemo(() => toolsApi(client), [client])
  const backends = useMemo(() => backendsApi(client), [client])

  const [tools, setTools] = useState<ToolInfo[]>([])
  const [platform, setPlatform] = useState<string>('')
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<string>(LOCAL)
  const [states, setStates] = useState<Record<string, TabState>>({})
  const [openProgram, setOpenProgram] = useState<string | null>(null)

  const tabs = useMemo<Tab[]>(
    () => [
      { id: LOCAL, label: 'This machine', kind: 'local', where: 'this machine' },
      ...profiles.map((p) => ({ id: p.id, label: p.name, kind: p.kind, where: `${p.name} (${summary(p)})` })),
    ],
    [profiles],
  )

  /** Probe every tool on the engine host, one request each (progressive badges). */
  const probeLocal = useCallback(
    (programs: string[]) => {
      setStates((prev) => ({ ...prev, [LOCAL]: { busy: true, pending: new Set(programs), probes: {}, error: null } }))
      for (const program of programs) {
        void api
          .probe(program)
          .then((r) =>
            setStates((prev) => {
              const s = prev[LOCAL]
              if (s === undefined) return prev
              return { ...prev, [LOCAL]: { ...s, probes: { ...s.probes, [program]: r } } }
            }),
          )
          .catch(() => undefined)
          .finally(() =>
            setStates((prev) => {
              const s = prev[LOCAL]
              if (s === undefined) return prev
              const pending = new Set(s.pending)
              pending.delete(program)
              return { ...prev, [LOCAL]: { ...s, pending, busy: pending.size > 0 } }
            }),
          )
      }
    },
    [api],
  )

  /** Probe every tool on one connection in a single round trip. */
  const probeRemote = useCallback(
    (backendId: string, programs: string[]) => {
      setStates((prev) => ({
        ...prev,
        [backendId]: { busy: true, pending: new Set<string>(), probes: {}, error: null },
      }))
      void api
        .probeBatch(programs, backendId)
        .then((res) => {
          const probes: Record<string, ToolProbeResult> = {}
          for (const r of res.results) probes[r.program] = r
          setStates((prev) => ({
            ...prev,
            [backendId]: { busy: false, pending: new Set<string>(), probes, error: res.error ?? null },
          }))
        })
        .catch(() =>
          setStates((prev) => ({
            ...prev,
            [backendId]: {
              busy: false,
              pending: new Set<string>(),
              probes: {},
              error: 'Could not reach the engine to check this connection.',
            },
          })),
        )
    },
    [api],
  )

  const probeTab = useCallback(
    (tabId: string, programs: string[]) => {
      if (programs.length === 0) return
      if (tabId === LOCAL) probeLocal(programs)
      else probeRemote(tabId, programs)
    },
    [probeLocal, probeRemote],
  )

  /** Load the catalog and the saved connections; probe the local tab eagerly. */
  const loadCatalog = useCallback(() => {
    setLoading(true)
    setError(null)
    setStates({})
    void backends
      .list()
      .then(setProfiles)
      .catch(() => setProfiles([]))
    void api
      .list()
      .then((data) => {
        setTools(data.tools)
        setPlatform(data.platform)
        probeTab(active, data.tools.map((t) => t.program))
      })
      .catch(() => setError('Could not reach the engine to check tools.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, backends, probeTab])

  useEffect(() => {
    loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // A tab probes the first time it is opened; after that its results are cached.
  const selectTab = useCallback(
    (id: string) => {
      setActive(id)
      setOpenProgram(null)
      if (states[id] === undefined) probeTab(id, tools.map((t) => t.program))
    },
    [states, tools, probeTab],
  )

  const state = states[active]
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0]!
  const unreachable = state?.error != null

  const stateFor = (program: string): CardState => {
    if (unreachable) return 'unreachable'
    if (state === undefined) return 'checking'
    if (state.pending.has(program)) return 'checking'
    const r = state.probes[program]
    if (r === undefined) return state.busy ? 'checking' : 'unreachable'
    return r.installed ? 'installed' : 'missing'
  }

  /** Missing count for a tab's badge — null until that tab has finished a probe. */
  const missingFor = useCallback(
    (id: string): number | null => {
      const s = states[id]
      if (s === undefined || s.busy || s.error != null) return null
      return tools.filter((t) => s.probes[t.program]?.installed === false).length
    },
    [states, tools],
  )

  const anyChecking = loading || state === undefined || state.busy
  const missing = tools.filter((t) => stateFor(t.program) === 'missing').length
  const openTool = openProgram !== null ? tools.find((t) => t.program === openProgram) : undefined

  const recheck = (): void => probeTab(active, tools.map((t) => t.program))

  return (
    <>
      {tabs.length > 1 && <TabStrip tabs={tabs} active={active} onSelect={selectTab} missingFor={missingFor} />}

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          {anyChecking
            ? 'Checking…'
            : unreachable
              ? 'Connection unreachable'
              : `${tools.length} tool${tools.length === 1 ? '' : 's'}${missing > 0 ? `, ${missing} missing` : ', all installed'}`}
        </p>
        <Button variant="outline" size="sm" disabled={anyChecking} onClick={recheck}>
          {anyChecking ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
          Recheck
        </Button>
      </div>

      {unreachable && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2.5">
          <Unplug className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <div className="min-w-0 text-[12px]">
            <div className="font-medium">Could not reach {activeTab.label}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground" title={state?.error ?? ''}>
              {state?.error}
            </div>
          </div>
        </div>
      )}

      {error !== null ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tools.map((tool) => (
            <ToolCard
              key={tool.program}
              tool={tool}
              state={stateFor(tool.program)}
              version={state?.probes[tool.program]?.version ?? null}
              onInstall={() => setOpenProgram(tool.program)}
            />
          ))}
        </div>
      )}

      {openTool !== undefined && (
        <InstallModal
          tool={openTool}
          // A remote host's OS is unknown, so no "(this machine)" marker there.
          platform={active === LOCAL ? platform : ''}
          where={activeTab.where}
          rechecking={state?.busy ?? false}
          onClose={() => setOpenProgram(null)}
          onRecheck={() => {
            setOpenProgram(null)
            recheck()
          }}
        />
      )}
    </>
  )
}

/** Settings sub-page wrapper: heading + the tool cards (needs an engagement). */
export function ToolsSection(): JSX.Element {
  const client = useApp((s) => s.client)
  return (
    <div>
      <PageHeading
        title="Tools"
        description="External CLI tools the workflow nodes run, and whether they are installed on each connection."
      />
      {client === null ? (
        <p className="text-xs text-muted-foreground">Open an engagement to check tools.</p>
      ) : (
        <ToolsList client={client} />
      )}
    </div>
  )
}
