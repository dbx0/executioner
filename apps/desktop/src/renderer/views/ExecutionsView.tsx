import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Workflow, Crosshair } from 'lucide-react'
import { useApp } from '../store.js'
import { executionsApi, type ExecutionSummary, type NodeOutputRow } from '../api/executions.js'
import { workflowsApi } from '../api/workflows.js'
import { targetsApi } from '../api/targets.js'
import { useEngineEvents } from '../lib/events.js'
import { ScrollArea } from '../components/ui/scroll-area.js'
import { mergeNodeRows } from './executions/merge.js'
import { NodeOutputCards } from './executions/NodeOutputCards.js'
import { NodeOutputModal } from './executions/NodeOutputModal.js'
import { Button } from '../components/ui/button.js'
import { ExecutionListSkeleton } from './executions/ExecutionListSkeleton.js'
import { ExecutionList } from './executions/ExecutionList.js'
import { shortId, statusColor } from './executions/status.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page, PageBody, PageToolbar } from '../components/ui/page.js'
import { LoadingState, Spinner } from '../components/ui/spinner.js'
import { Tip } from '../components/ui/tip.js'
import { cn } from '../lib/utils.js'

/**
 * The runs page: the list of runs beside the selected run's node output. Also
 * hosted inside the Workflows hub (`embedded`), where the host supplies the
 * frame and this renders only the two panes.
 */
export function ExecutionsView({ embedded = false }: { embedded?: boolean } = {}): JSX.Element {
  const client = useApp((s) => s.client)!
  const connection = useApp((s) => s.connection)!
  const api = useMemo(() => executionsApi(client), [client])

  const [rows, setRows] = useState<ExecutionSummary[]>([])
  const [selected, setSelected] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  /** First load done (success or failure). Until then the list shows placeholders
   *  rather than the empty state, which otherwise claims there are no runs. */
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [persisted, setPersisted] = useState<NodeOutputRow[]>([])
  /** The run whose persisted output has been read at least once, so the pane
   *  shows a loader rather than "no output" while the first read is in flight. */
  const [outputFor, setOutputFor] = useState<string | undefined>()
  const [openNode, setOpenNode] = useState<NodeOutputRow | null>(null)
  const [wfNames, setWfNames] = useState<Record<string, string>>({})
  /** The run whose stop is in flight, so its button can't be pressed twice. */
  const [stopping, setStopping] = useState<string | null>(null)
  const [targetVals, setTargetVals] = useState<Record<string, string>>({})

  const events = useEngineEvents(connection)
  const bottomRef = useRef<HTMLDivElement>(null)

  // A deep-link from the sidebar's Runs list: select that run once, then clear.
  const pendingExecutionId = useApp((s) => s.pendingExecutionId)
  const setPendingExecutionId = useApp((s) => s.setPendingExecutionId)
  useEffect(() => {
    if (pendingExecutionId === null) return
    setSelected(pendingExecutionId)
    setPendingExecutionId(null)
  }, [pendingExecutionId, setPendingExecutionId])

  // Resolve workflow ids -> names and target ids -> values so runs read clearly.
  useEffect(() => {
    void workflowsApi(client)
      .list()
      .then((list) => setWfNames(Object.fromEntries(list.map((w) => [w.id, w.name]))))
      .catch(() => {})
    void targetsApi(client)
      .list()
      .then((list) => setTargetVals(Object.fromEntries(list.map((t) => [t.id, t.value]))))
      .catch(() => {})
  }, [client])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.list()
      setRows(list)
      if (selected === undefined && list.length > 0) setSelected(list[0]?.id)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [api, selected])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Stop a run. The engine kills whatever the run has open and settles the row,
   * then announces it on the event bus, but the list is re-read here too, so
   * the row updates even if that event is missed.
   */
  const stop = useCallback(
    async (executionId: string) => {
      setStopping(executionId)
      try {
        await api.cancel(executionId)
      } catch {
        /* the run had already finished; the refresh below shows what it became */
      } finally {
        setStopping(null)
        void refresh()
      }
    },
    [api, refresh],
  )

  // Refresh the list when a run finishes.
  useEffect(() => {
    const last = events[events.length - 1]
    if (last?.type === 'done' || last?.type === 'status') void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length])

  const log = useMemo(
    () => events.filter((e) => e.executionId === selected && (e.type === 'stdout' || e.type === 'stderr')),
    [events, selected],
  )

  /**
   * Final status per node, straight off the event bus. The engine publishes a
   * node's 'done' event before it writes the row, so a refetch triggered by that
   * event can find nothing yet. Without this a node that plainly finished keeps
   * rendering as "running" until some later fetch catches up.
   */
  const doneStatus = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of events) {
      if (e.executionId !== selected) continue
      // 'status: running' announces a node before it has produced anything; a
      // later 'done' overwrites it. Order matters, so both are folded in turn.
      if (e.type === 'status' && String(e.data) === 'running') m.set(e.nodeId, 'running')
      else if (e.type === 'done') m.set(e.nodeId, String(e.data))
    }
    return m
  }, [events, selected])

  // Load the run's persisted output (from evidence files) so output survives
  // after the live event buffer rolls, and past runs can be reopened. Refetched
  // when the selection changes and when a done event lands for it.
  // One refetch per completed node: keying on "the last event is done" missed
  // completions as soon as any further event arrived behind them.
  const doneCount = useMemo(
    () => events.filter((e) => e.executionId === selected && e.type === 'done').length,
    [events, selected],
  )
  useEffect(() => {
    if (selected === undefined) {
      setPersisted([])
      return
    }
    let alive = true
    void api
      .output(selected)
      .then((o) => alive && setPersisted(o))
      .catch(() => alive && setPersisted([]))
      .finally(() => alive && setOutputFor(selected))
    return () => {
      alive = false
    }
  }, [selected, api, doneCount])

  /**
   * One row per node of the selected run. Persisted evidence is authoritative;
   * a node still streaming (or one the refetch hasn't caught yet) is filled in
   * from the live event buffer so a running node isn't a blank card.
   *
   * Every node is kept, including those with no output at all: a node that
   * drops off the list is precisely how a silent failure goes unnoticed.
   */
  const nodeRows = useMemo(() => mergeNodeRows(persisted, log, doneStatus), [persisted, log, doneStatus])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [log.length])

  const run = rows.find((r) => r.id === selected)
  const outputPending = selected !== undefined && outputFor !== selected && nodeRows.length === 0

  const panes = (
    <>
      <GlassPanel className="flex w-80 shrink-0 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          {!loadedOnce ? (
            <ExecutionListSkeleton />
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No runs yet. Run a workflow or a node.</p>
          ) : (
            <ExecutionList
              rows={rows}
              selected={selected}
              stopping={stopping}
              workflowNames={wfNames}
              targetValues={targetVals}
              onSelect={setSelected}
              onStop={(id) => void stop(id)}
            />
          )}
        </ScrollArea>
      </GlassPanel>

      <GlassPanel className="flex min-w-0 flex-1 flex-col">
        {selected === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a run to see its output.</p>
          </div>
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-glass-border px-4 text-xs text-muted-foreground">
              <Workflow className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
              <span className="truncate font-medium text-foreground">
                {run?.workflowId != null ? (wfNames[run.workflowId] ?? 'Workflow') : 'Single node'}
              </span>
              {run?.targetId != null && (
                <>
                  <span>·</span>
                  <Crosshair className="size-3" strokeWidth={1.75} />
                  <span className="truncate font-mono">{targetVals[run.targetId] ?? shortId(run.targetId)}</span>
                </>
              )}
              <span className={cn('ml-auto capitalize', statusColor(run?.status ?? ''))}>{run?.status ?? 'unknown'}</span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {nodeRows.length > 0 ? (
                <NodeOutputCards rows={nodeRows} onOpen={setOpenNode} />
              ) : outputPending ? (
                <LoadingState label="Loading output" />
              ) : (
                <p className="p-4 text-[13px] text-muted-foreground">No output recorded for this run.</p>
              )}
              <div ref={bottomRef} />
            </ScrollArea>
          </>
        )}
      </GlassPanel>
    </>
  )

  const modal = openNode !== null && <NodeOutputModal row={openNode} onClose={() => setOpenNode(null)} />

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 gap-panel">
        {panes}
        {modal}
      </div>
    )
  }

  return (
    <Page>
      <PageToolbar
        title="Executions"
        meta={loadedOnce ? rows.length : undefined}
        actions={
          <Tip label="Refresh">
            <Button variant="glass" size="icon-sm" disabled={loading} onClick={() => void refresh()} aria-label="Refresh">
              {loading ? <Spinner /> : <RefreshCw className="size-4" strokeWidth={1.75} />}
            </Button>
          </Tip>
        }
      />
      <PageBody>{panes}</PageBody>
      {modal}
    </Page>
  )
}
