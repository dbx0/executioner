import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store.js'
import { nodesApi, type NodeListing } from '../api/nodes.js'
import { targetsApi, type TargetSummary } from '../api/targets.js'
import { backendsApi, type BackendProfile } from '../api/backends.js'
import { executionsApi, type NodeOutputRow, type StandaloneRun } from '../api/executions.js'
import { toolsApi, type ToolInfo } from '../api/tools.js'
import { apiErrorMessage } from '../lib/api-error.js'
import { cn } from '../lib/utils.js'
import { RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/button.js'
import { InstallModal } from './settings/tools/InstallModal.js'
import { CatalogPane, type InstallState } from './tools/CatalogPane.js'
import { RunForm } from './tools/RunForm.js'
import type { CommandPreviewState } from './tools/CommandPreview.js'
import { ConnectionPicker, LOCAL } from './tools/ConnectionPicker.js'
import { OutputPane } from './tools/OutputPane.js'
import { EMPTY_PAGE, subscribeToolEvents, useToolsStore, type ProbeState, type ToolsPage } from './tools/tools-store.js'
import { NodeOutputModal } from './executions/NodeOutputModal.js'
import { safeRow } from './executions/row.js'

const NO_LINES: string[] = []
const NO_PROBES: Record<string, ProbeState> = {}


/**
 * Tools: run one tool against one target or several, on any connection,
 * without building a workflow first.
 *
 * A run here is an ordinary execution — it shows up in Runs, it emits targets
 * and facts, and it stops when told to. What this page adds is the shortest
 * path to starting one: a catalog that knows what is installed where, a form
 * that remembers how you last ran each tool, and the output in the same view.
 */
export function ToolsView(): JSX.Element {
  const client = useApp((s) => s.client)
  const connection = useApp((s) => s.connection) ?? undefined

  const [nodes, setNodes] = useState<NodeListing[]>([])
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [catalog, setCatalog] = useState<Record<string, ToolInfo>>({})
  const [recent, setRecent] = useState<StandaloneRun[]>([])
  const [platform, setPlatform] = useState('')

  // What the user picked and the run they are watching live in the tools
  // store, per engagement, so switching views and back finds the page as left.
  const root = connection?.projectRoot ?? ''
  const page = useToolsStore((s) => s.pages[root] ?? EMPTY_PAGE)
  const update = useToolsStore((s) => s.update)
  const { query, nodeId, targetIds, backendId, params, paramsOrigin, connectionNote, live } = page
  const { setQuery, setNodeId, setTargetIds, setBackendId, setParams, setParamsOrigin, setConnectionNote, setLive } =
    useMemo(() => {
      const field =
        <K extends keyof ToolsPage>(key: K) =>
        (value: ToolsPage[K] | ((prev: ToolsPage[K]) => ToolsPage[K])): void =>
          update(root, (p) => ({
            ...p,
            [key]: typeof value === 'function' ? (value as (prev: ToolsPage[K]) => ToolsPage[K])(p[key]) : value,
          }))
      return {
        setQuery: field('query'),
        setNodeId: field('nodeId'),
        setTargetIds: field('targetIds'),
        setBackendId: field('backendId'),
        setParams: field('params'),
        setParamsOrigin: field('paramsOrigin'),
        setConnectionNote: field('connectionNote'),
        setLive: field('live'),
      }
    }, [root, update])

  // Tool output keeps arriving while the page is away; this only makes sure
  // the engagement's subscription is open. It is never closed from here.
  useEffect(() => {
    if (connection !== undefined) subscribeToolEvents(connection)
  }, [connection])
  const runs = useToolsStore((s) => s.runs[root])
  const probes = useToolsStore((s) => s.probes[root]) ?? NO_PROBES
  const setProbes = useCallback(
    (fn: (prev: Record<string, ProbeState>) => Record<string, ProbeState>) =>
      useToolsStore.getState().updateProbes(root, fn),
    [root],
  )
  const watch = useCallback(
    (executionId: string) => useToolsStore.getState().watch(root, executionId),
    [root],
  )

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // Tagged with the tool it was built for, so a stale one never shows under
  // another tool while the next is on its way.
  const [preview, setPreview] = useState<{ nodeId: string; state: CommandPreviewState } | null>(null)
  const [stopping, setStopping] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  // Saved output per settled run, fetched once each: null when the engine has
  // none. Keyed by run, so nothing has to be cleared when the pane switches.
  const [outputs, setOutputs] = useState<Record<string, NodeOutputRow | null>>({})
  const [expanded, setExpanded] = useState(false)
  // A ticking clock so a live run's elapsed time advances; idle costs nothing.
  const [now, setNow] = useState(() => Date.now())

  // A deep link from a target's right-click menu: start with that target
  // picked. Consumed once, like the other pending-id links. Picking a tool that
  // cannot take its kind still drops it, exactly as if it had been clicked here.
  const pendingToolTargetId = useApp((s) => s.pendingToolTargetId)
  const setPendingToolTargetId = useApp((s) => s.setPendingToolTargetId)
  useEffect(() => {
    if (pendingToolTargetId === null) return
    setTargetIds([pendingToolTargetId])
    setPendingToolTargetId(null)
  }, [pendingToolTargetId, setPendingToolTargetId, setTargetIds])

  const node = useMemo(() => nodes.find((n) => n.id === nodeId) ?? null, [nodes, nodeId])

  // ---- loading -------------------------------------------------------------

  const refreshRecent = useCallback(() => {
    if (client === null) return
    void executionsApi(client)
      .standalone()
      .then(setRecent)
      .catch(() => setRecent([]))
  }, [client])

  useEffect(() => {
    if (client === null) return
    void nodesApi(client)
      .list()
      .then(setNodes)
      .catch(() => setNodes([]))
    void targetsApi(client)
      .list()
      .then(setTargets)
      .catch(() => setTargets([]))
    void backendsApi(client)
      .list()
      .then(setProfiles)
      .catch(() => setProfiles([]))
    void toolsApi(client)
      .list()
      .then((data) => {
        setPlatform(data.platform)
        setCatalog(Object.fromEntries(data.tools.map((t) => [t.program, t])))
      })
      .catch(() => setCatalog({}))
    refreshRecent()
  }, [client, refreshRecent])

  // ---- install status, per connection --------------------------------------

  const programs = useMemo(() => {
    const set = new Set<string>()
    for (const n of nodes) if (n.program !== undefined && n.program !== '') set.add(n.program)
    return [...set]
  }, [nodes])

  // A check that could not reach its connection is not an answer worth
  // keeping: ask again each time the page opens. Answers are kept.
  useEffect(() => {
    setProbes((prev) => Object.fromEntries(Object.entries(prev).filter(([, p]) => p.error === null)))
  }, [setProbes])

  /** Forget this connection's answer, so it is asked again. */
  const recheck = useCallback(() => {
    setProbes((prev) => {
      const next = { ...prev }
      delete next[backendId]
      return next
    })
  }, [setProbes, backendId])

  // Probe the selected connection once, the first time it is used. Same cost
  // model as Settings: one round trip per connection, kept after that, across
  // view switches, until Recheck.
  useEffect(() => {
    if (client === null || programs.length === 0) return
    if (probes[backendId] !== undefined) return
    setProbes((prev) => ({ ...prev, [backendId]: { busy: true, byProgram: {}, error: null } }))
    void toolsApi(client)
      .probeBatch(programs, backendId === LOCAL ? undefined : backendId)
      .then((res) =>
        setProbes((prev) => ({
          ...prev,
          [backendId]: {
            busy: false,
            byProgram: Object.fromEntries(res.results.map((r) => [r.program, r])),
            error: res.error ?? null,
          },
        })),
      )
      .catch(() =>
        setProbes((prev) => ({
          ...prev,
          [backendId]: { busy: false, byProgram: {}, error: 'Could not reach the engine.' },
        })),
      )
  }, [client, programs, backendId, probes, setProbes])

  const installState = useCallback(
    (n: NodeListing): InstallState => {
      const state = probes[backendId]
      if (n.program === undefined || n.program === '') return 'unknown'
      // An unreachable connection makes every tool unknown, never "missing":
      // the tool may well be there, we just could not ask.
      if (state === undefined || state.busy || state.error !== null) return 'unknown'
      const probe = state.byProgram[n.program]
      if (probe === undefined) return 'unknown'
      return probe.installed ? 'installed' : 'missing'
    },
    [probes, backendId],
  )

  // ---- selection -----------------------------------------------------------

  /** A tool's last-used params: the newest standalone run of that node. */
  const lastParamsFor = useCallback(
    (id: string): Record<string, unknown> => recent.find((r) => r.nodeId === id)?.params ?? {},
    [recent],
  )

  const selectNode = useCallback(
    (id: string) => {
      setNodeId(id)
      setStartError(null)
      const last = lastParamsFor(id)
      setParams(last)
      setParamsOrigin(Object.keys(last).length > 0 ? 'last-run' : null)
      // A target the new tool cannot accept would only earn a 400, so drop it.
      const next = nodes.find((n) => n.id === id)
      if (next !== undefined && next.accepts.length > 0) {
        setTargetIds((ids) =>
          ids.filter((tid) => {
            const t = targets.find((x) => x.id === tid)
            return t !== undefined && next.accepts.includes(t.kind)
          }),
        )
      }
    },
    [nodes, targets, lastParamsFor, setNodeId, setParams, setParamsOrigin, setTargetIds],
  )

  /**
   * The saved connection a past run used. Runs saved before the profile id was
   * kept carry only the kind ("ssh"); with exactly one profile of that kind the
   * answer is still certain. A run that named a profile now deleted has no
   * answer: another profile of the same kind is a different machine. Null means
   * unknown, which is NOT this machine.
   */
  const profileFor = useCallback(
    (run: StandaloneRun): BackendProfile | null => {
      if (run.backendProfileId !== null) return profiles.find((p) => p.id === run.backendProfileId) ?? null
      if (run.backend === LOCAL) return null
      const sameKind = profiles.filter((p) => p.kind === run.backend)
      return sameKind.length === 1 ? sameKind[0]! : null
    },
    [profiles],
  )

  /** Where a past run executed, in words: its connection's name when known. */
  const connectionLabel = useCallback(
    (run: StandaloneRun): string => {
      if (run.backend === LOCAL) return 'this machine'
      return profileFor(run)?.name ?? run.backend
    },
    [profileFor],
  )

  /** Load a past run's whole setup back into the form. */
  const replay = useCallback(
    (run: StandaloneRun) => {
      setNodeId(run.nodeId)
      setStartError(null)
      setParams(run.params)
      setParamsOrigin(Object.keys(run.params).length > 0 ? 'replay' : null)
      if (run.targetId !== null && targets.some((t) => t.id === run.targetId)) setTargetIds([run.targetId])
      // A run on this machine goes back to this machine. A remote run whose
      // connection cannot be found (deleted, or ambiguous) keeps the current
      // selection and says so: quietly switching to this machine would run a
      // remote-only tool where it is not installed.
      const profile = profileFor(run)
      if (run.backend === LOCAL) {
        setBackendId(LOCAL)
        setConnectionNote(null)
      } else if (profile !== null) {
        setBackendId(profile.id)
        setConnectionNote(null)
      } else {
        setConnectionNote(`The ${run.backend} connection this run used is gone, so pick where to run it.`)
      }
      // And show what it produced. A run still going streams like one started here.
      const startedAt = run.startedAt === null ? Date.now() : Date.parse(run.startedAt)
      if (run.status === 'running') watch(run.id)
      setLive({ executionId: run.id, nodeId: run.nodeId, status: run.status, startedAt })
    },
    [targets, profileFor, watch, setNodeId, setParams, setParamsOrigin, setTargetIds, setBackendId, setConnectionNote, setLive],
  )

  /** Create a target from the form, then pick it alongside any already picked. */
  const addTarget = useCallback(
    async (kind: string, value: string): Promise<void> => {
      if (client === null) return
      const api = targetsApi(client)
      let created: TargetSummary
      try {
        created = (await api.create({ kind, value, source: 'manual' })) as TargetSummary
      } catch (e) {
        throw new Error(apiErrorMessage(e, 'Could not add that target.'), { cause: e })
      }
      setTargets(await api.list().catch(() => [...targets, created]))
      setTargetIds((ids) => (ids.includes(created.id) ? ids : [...ids, created.id]))
      setStartError(null)
    },
    [client, targets, setTargetIds],
  )

  // ---- command preview -----------------------------------------------------

  // The engine builds the argv, so the preview is exactly what a run executes.
  // Debounced, since every keystroke in a param changes it.
  useEffect(() => {
    if (client === null || node === null) return
    let cancelled = false
    const timer = setTimeout(() => {
      void nodesApi(client)
        .preview(node.id, { params, ...(targetIds[0] === undefined ? {} : { targetId: targetIds[0] }) })
        .then((argv) => ({ argv }))
        .catch((e: unknown) => ({ error: apiErrorMessage(e, 'The engine could not build it.') }))
        .then((state) => {
          if (!cancelled) setPreview({ nodeId: node.id, state })
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, node, targetIds, params])

  // ---- running -------------------------------------------------------------

  /**
   * One run per picked target, all at once: each is its own execution, so each
   * lands in the history, streams, and stops on its own. The pane follows the
   * first one that started; the rest are a click away in Recent runs.
   */
  const run = useCallback(() => {
    if (client === null || node === null || targetIds.length === 0) return
    setStarting(true)
    setStartError(null)
    const api = nodesApi(client)
    const body = { params, ...(backendId === LOCAL ? {} : { backendProfileId: backendId }) }
    void Promise.allSettled(targetIds.map((tid) => api.run(node.id, { targetId: tid, ...body })))
      .then((results) => {
        for (const r of results) if (r.status === 'fulfilled') watch(r.value.executionId)
        const first = results.find((r) => r.status === 'fulfilled')
        if (first !== undefined) {
          setLive({ executionId: first.value.executionId, nodeId: node.id, status: 'running', startedAt: Date.now() })
        }
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failed.length > 0) {
          const why = apiErrorMessage(failed[0]!.reason, 'The run did not start.')
          setStartError(results.length === 1 ? why : `${failed.length} of ${results.length} runs did not start: ${why}`)
        }
        refreshRecent()
      })
      .finally(() => setStarting(false))
  }, [client, node, targetIds, params, backendId, refreshRecent, watch, setLive])

  const stop = useCallback(() => {
    if (client === null || live === null) return
    setStopping(true)
    void executionsApi(client)
      .cancel(live.executionId)
      .catch(() => undefined)
      .finally(() => setStopping(false))
  }, [client, live])

  // The live run's stream, and its settle. Only this execution's output counts:
  // a workflow running alongside must not write into this pane.
  const finished = runs?.finished
  const lines = (live === null ? undefined : runs?.streams[live.executionId]?.chunks) ?? NO_LINES

  // Settled by its done event, heard even while the page was away. If even that
  // was missed (the engine restarted, say), the history's word is final.
  useEffect(() => {
    if (live === null || live.status !== 'running') return
    const status = finished?.[live.executionId] ?? recent.find((r) => r.id === live.executionId && r.status !== 'running')?.status
    if (status === undefined) return
    setLive((cur) => (cur === null || cur.executionId !== live.executionId ? cur : { ...cur, status }))
    refreshRecent()
  }, [finished, recent, live, refreshRecent, setLive])

  // Any run the history still shows as running, not just the watched one, is
  // refreshed when it finishes, so several runs at once all settle in the list.
  // Each id is refreshed for once: the list may lag the event by a moment, and
  // asking again on every render until it catches up would be a loop.
  const settledSeen = useRef(new Set<string>())
  useEffect(() => {
    const done = recent.filter(
      (r) =>
        r.status === 'running' &&
        !settledSeen.current.has(r.id) &&
        finished?.[r.id] !== undefined,
    )
    if (done.length === 0) return
    for (const r of done) settledSeen.current.add(r.id)
    refreshRecent()
  }, [finished, recent, refreshRecent])

  // Once the watched run has settled, fetch what the engine saved for it: the
  // same per-node rows the Runs view reads, parsed records included.
  const settledId = live !== null && live.status !== 'running' ? live.executionId : null
  const settledNode = live?.nodeId ?? null
  useEffect(() => {
    if (client === null || settledId === null || outputs[settledId] !== undefined) return
    let cancelled = false
    void executionsApi(client)
      .output(settledId)
      .then((rows) => rows.find((r) => r.nodeId === settledNode) ?? rows[0] ?? null)
      .catch(() => null)
      .then((row) => {
        if (!cancelled) setOutputs((prev) => ({ ...prev, [settledId]: row }))
      })
    return () => {
      cancelled = true
    }
  }, [client, settledId, settledNode, outputs])

  const rawResult = settledId === null ? undefined : outputs[settledId]
  const result = useMemo(() => (rawResult == null ? rawResult : safeRow(rawResult)), [rawResult])

  // Every second while a run is live; otherwise slowly, so "2m ago" in the
  // recent runs list stays roughly true.
  const ticking = live !== null && live.status === 'running'
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ticking ? 1000 : 30_000)
    return () => clearInterval(timer)
  }, [ticking])

  // ---- keyboard ------------------------------------------------------------

  // Ctrl/Cmd+Enter presses Run, so it obeys every reason Run is disabled; "/"
  // jumps to tool search unless the user is typing somewhere. Both stand down
  // while a dialog is open over the page.
  const searchRef = useRef<HTMLInputElement>(null)
  const runRef = useRef<HTMLButtonElement>(null)
  const dialogOpen = expanded || installOpen
  useEffect(() => {
    if (dialogOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        const button = runRef.current
        if (button === null || button.disabled) return
        e.preventDefault()
        button.click()
        return
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = document.activeElement
        const typing =
          el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        if (typing) return
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialogOpen])

  const nodeName = useCallback(
    (id: string) => nodes.find((n) => n.id === id)?.name ?? id,
    [nodes],
  )

  if (client === null) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-xs text-muted-foreground">Open an engagement to run tools.</p>
      </div>
    )
  }

  const installTool = node?.program !== undefined ? catalog[node.program] : undefined

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        role="toolbar"
        aria-label="Tools"
        className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4"
      >
        <span className="text-[13px] font-medium">Tools</span>
        <span className="text-[11px] text-muted-foreground">{nodes.length}</span>
        <div data-tour="tools-connection" className="ml-auto flex min-w-0 items-center gap-2">
          {probes[backendId]?.error != null && (
            <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
              Could not check this connection, so install state is unknown.
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Recheck installed tools"
            title="Recheck installed tools"
            disabled={probes[backendId]?.busy ?? false}
            onClick={recheck}
          >
            <RefreshCw className={cn('size-3.5', probes[backendId]?.busy === true && 'animate-spin')} />
          </Button>
          <ConnectionPicker
            profiles={profiles}
            value={backendId}
            onChange={(id) => {
              setBackendId(id)
              setConnectionNote(null)
            }}
          />
        </div>
      </div>

      {/* Three columns when there is room. Narrower, they stack catalog over
          form over output and the whole view scrolls, so the output keeps a
          readable width instead of being squeezed beside the form. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-sleek min-[1100px]:flex-row min-[1100px]:overflow-hidden">
        <CatalogPane
          nodes={nodes}
          query={query}
          onQuery={setQuery}
          selectedId={nodeId}
          onSelect={selectNode}
          installState={installState}
          searchRef={searchRef}
        />
        <div data-tour="tools-run" className="min-h-[320px] min-w-0 shrink-0 min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:shrink">
          <RunForm
            node={node}
            targets={targets}
            targetIds={targetIds}
            onAddTarget={addTarget}
            onTargetIds={(ids) => {
              setTargetIds(ids)
              setStartError(null)
            }}
            params={params}
            onParam={(name, value) => {
              setParams((prev) => ({ ...prev, [name]: value }))
              setParamsOrigin('edited')
              setStartError(null)
            }}
            paramsOrigin={paramsOrigin}
            onResetParams={() => {
              setParams({})
              setParamsOrigin(null)
            }}
            installState={node === null ? 'unknown' : installState(node)}
            preview={preview !== null && preview.nodeId === nodeId ? preview.state : null}
            startError={startError}
            starting={starting}
            onRun={run}
            onInstall={() => setInstallOpen(true)}
            runRef={runRef}
            runsOn={backendId === LOCAL ? 'this machine' : (profiles.find((p) => p.id === backendId)?.name ?? 'this connection')}
            connectionNote={connectionNote}
          />
        </div>
        <OutputPane
          live={live}
          lines={lines}
          result={result}
          onExpand={() => setExpanded(true)}
          now={now}
          stopping={stopping}
          onStop={stop}
          recent={recent}
          selectedNodeId={nodeId}
          watchingId={live?.executionId ?? null}
          connectionLabel={connectionLabel}
          nodeName={nodeName}
          onReplay={replay}
        />
      </div>

      {expanded && rawResult != null && (
        <NodeOutputModal row={rawResult} preferParsed subject="run" onClose={() => setExpanded(false)} />
      )}

      {installOpen && installTool !== undefined && (
        <InstallModal
          tool={installTool}
          // Only this machine's OS is known; a remote host's is not.
          platform={backendId === LOCAL ? platform : ''}
          where={backendId === LOCAL ? 'this machine' : (profiles.find((p) => p.id === backendId)?.name ?? 'this connection')}
          rechecking={probes[backendId]?.busy ?? false}
          onClose={() => setInstallOpen(false)}
          onRecheck={() => {
            setInstallOpen(false)
            recheck()
          }}
        />
      )}
    </div>
  )
}
