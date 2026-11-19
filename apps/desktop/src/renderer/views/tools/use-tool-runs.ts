import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { nodesApi, type NodeListing } from '../../api/nodes.js'
import { executionsApi, type NodeOutputRow } from '../../api/executions.js'
import { apiErrorMessage } from '../../lib/api-error.js'
import { safeRow, type SafeRow } from '../executions/row.js'
import { LOCAL } from './ConnectionPicker.js'
import type { BatchTab } from './BatchStrip.js'
import type { ToolsData } from './use-tools-data.js'
import type { ToolsPageState } from './use-tools-page.js'

const NO_LINES: string[] = []

export interface ToolRuns {
  starting: boolean
  stopping: boolean
  /** Start one run per picked target. */
  run: () => void
  /** Cancel the watched run. */
  stop: () => void
  /** The watched run's stream so far. */
  lines: string[]
  /** Each run of the batch, as its tab shows it. */
  batchTabs: BatchTab[]
  /** Tools with a run still going, whichever tool is on screen. */
  runningTools: ReadonlySet<string>
  /** Put one run of the batch on screen; it keeps streaming if it is still going. */
  showRun: (executionId: string) => void
  /** The settled run's saved row as the engine sent it: undefined while it loads, null when there is none. */
  rawResult: NodeOutputRow | null | undefined
  /** The same row, made safe to render. */
  result: SafeRow | null | undefined
  /** A ticking clock, so elapsed times advance. */
  now: number
}

/** Starting, stopping, watching and settling the page's runs. */
export function useToolRuns({
  client,
  node,
  data,
  state,
  setStartError,
}: {
  client: AxiosInstance | null
  node: NodeListing | null
  data: ToolsData
  state: ToolsPageState
  setStartError: (error: string | null) => void
}): ToolRuns {
  const { targets, recent, refreshRecent } = data
  const { live, batch, runs, watch, setLiveFor, setBatchFor, setTabFor } = state
  const { targetIds, params, backendId, lives } = state.page

  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  // Saved output per settled run, fetched once each: null when the engine has
  // none. Keyed by run, so nothing has to be cleared when the pane switches.
  const [outputs, setOutputs] = useState<Record<string, NodeOutputRow | null>>({})
  // A ticking clock so a live run's elapsed time advances; idle costs nothing.
  const [now, setNow] = useState(() => Date.now())

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
    const picked = [...targetIds]
    void Promise.allSettled(picked.map((tid) => api.run(node.id, { targetId: tid, ...body })))
      .then((results) => {
        const startedAt = Date.now()
        for (const r of results) if (r.status === 'fulfilled') watch(r.value.executionId)
        const first = results.find((r) => r.status === 'fulfilled')
        if (first !== undefined) {
          setLiveFor(node.id, { executionId: first.value.executionId, nodeId: node.id, status: 'running', startedAt })
          setTabFor(node.id, 'output')
        }
        // Every run that started, in the order the targets were picked, for the
        // pane's tabs. One run is not a batch.
        const started = results.flatMap((r, i) =>
          r.status === 'fulfilled'
            ? [{
                executionId: r.value.executionId,
                nodeId: node.id,
                target: targets.find((t) => t.id === picked[i])?.value ?? picked[i]!,
                startedAt,
              }]
            : [],
        )
        setBatchFor(node.id, started.length > 1 ? started : [])
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failed.length > 0) {
          const why = apiErrorMessage(failed[0]!.reason, 'The run did not start.')
          setStartError(results.length === 1 ? why : `${failed.length} of ${results.length} runs did not start: ${why}`)
        }
        refreshRecent()
      })
      .finally(() => setStarting(false))
  }, [client, node, targetIds, targets, params, backendId, refreshRecent, watch, setLiveFor, setBatchFor, setTabFor, setStartError])

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

  // Its end event decides; failing that, the history's word, so a missed event
  // still settles the tab.
  const batchTabs = useMemo(
    () =>
      batch.map((b) => ({
        executionId: b.executionId,
        label: b.target,
        status:
          finished?.[b.executionId] ??
          recent.find((r) => r.id === b.executionId && r.status !== 'running')?.status ??
          'running',
      })),
    [batch, finished, recent],
  )

  // A run left behind by picking another tool is easy to find again.
  const runningTools = useMemo(() => {
    const ids = new Set<string>()
    for (const run of Object.values(lives)) {
      const ended =
        finished?.[run.executionId] !== undefined ||
        recent.some((r) => r.id === run.executionId && r.status !== 'running')
      if (run.status === 'running' && !ended) ids.add(run.nodeId)
    }
    return ids
  }, [lives, finished, recent])

  const showRun = useCallback(
    (executionId: string) => {
      const entry = batch.find((b) => b.executionId === executionId)
      if (entry === undefined) return
      watch(executionId)
      const status = batchTabs.find((t) => t.executionId === executionId)?.status ?? 'running'
      setLiveFor(entry.nodeId, { executionId, nodeId: entry.nodeId, status, startedAt: entry.startedAt })
    },
    [batch, batchTabs, watch, setLiveFor],
  )

  // Settled by its done event, heard even while the page was away. If even that
  // was missed (the engine restarted, say), the history's word is final.
  useEffect(() => {
    if (live === null || live.status !== 'running') return
    const status = finished?.[live.executionId] ?? recent.find((r) => r.id === live.executionId && r.status !== 'running')?.status
    if (status === undefined) return
    setLiveFor(live.nodeId, (cur) => (cur === null || cur.executionId !== live.executionId ? cur : { ...cur, status }))
    refreshRecent()
  }, [finished, recent, live, refreshRecent, setLiveFor])

  // Any run the history still shows as running, not just the watched one, is
  // refreshed when it finishes, so several runs at once all settle in the list.
  // Each id is refreshed for once: the list may lag the event by a moment, and
  // asking again on every render until it catches up would be a loop.
  const settledSeen = useRef(new Set<string>())
  useEffect(() => {
    const done = recent.filter(
      (r) => r.status === 'running' && !settledSeen.current.has(r.id) && finished?.[r.id] !== undefined,
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

  return { starting, stopping, run, stop, lines, batchTabs, runningTools, showRun, rawResult, result, now }
}
