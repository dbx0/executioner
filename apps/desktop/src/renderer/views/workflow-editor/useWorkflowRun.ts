import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { AxiosInstance } from 'axios'
import type { Node } from 'reactflow'
import type { GraphNodeData } from '../../components/canvas/GraphNodes.js'
import { nodesApi } from '../../api/nodes.js'
import type { executionsApi } from '../../api/executions.js'
import { targetsApi, type TargetNode } from '../../api/targets.js'
import type { useEngineEvents } from '../../lib/events.js'
import { notify } from '../../lib/toast.js'
import { runSummaryMessage } from '../../lib/run-summary.js'
import { flatten } from './helpers.js'
import type { SingleRun } from './useLiveRunPaint.js'

type EngineEvents = ReturnType<typeof useEngineEvents>

/** The newest event sequence number: frames after it belong to a run launched now. */
const latestSeq = (events: EngineEvents): number => (events.length > 0 ? (events[events.length - 1]?.seq ?? 0) : 0)

/**
 * Running the workflow on the canvas: the run panel's choices (target, step
 * mode), launching a full run, stepping through one, and the single-node run.
 * Each async phase exposes a flag so its control can show a spinner.
 */
export function useWorkflowRun({
  client,
  exApi,
  events,
  nodes,
  setNodes,
  save,
  hasErrors,
  onInvalid,
  backendId,
}: {
  client: AxiosInstance
  exApi: ReturnType<typeof executionsApi>
  events: EngineEvents
  nodes: Node<GraphNodeData>[]
  setNodes: Dispatch<SetStateAction<Node<GraphNodeData>[]>>
  /** Persist the canvas and return the workflow id. */
  save: () => Promise<string | undefined>
  hasErrors: boolean
  /** Run was pressed on a graph that fails validation. */
  onInvalid: () => void
  backendId: string
}) {
  const [runOpen, setRunOpen] = useState(false)
  const [targets, setTargets] = useState<TargetNode[]>([])
  const [targetId, setTargetId] = useState<string | undefined>()
  const [runSeq, setRunSeq] = useState(0)
  const [stepMode, setStepMode] = useState(false)
  // The active stepped run, if any: its executionId drives the Next/Resume bar.
  const [stepExec, setStepExec] = useState<string | null>(null)
  const [singleRun, setSingleRun] = useState<SingleRun | null>(null)
  // Async phases, for the loaders: fetching targets to open the panel, saving
  // and launching, the run itself, and one Next request.
  const [opening, setOpening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [running, setRunning] = useState(false)
  const [stepping, setStepping] = useState(false)

  // Clear the step control bar once its execution reaches a terminal state.
  useEffect(() => {
    if (stepExec === null) return
    const done = events.some(
      (e) =>
        e.executionId === stepExec &&
        e.nodeId === '__execution__' &&
        e.type === 'status' &&
        (e.data === 'succeeded' || e.data === 'failed'),
    )
    if (done) {
      setStepExec(null)
      notify('Run complete')
    }
  }, [stepExec, events])

  const loadTargets = useCallback(async (): Promise<TargetNode[]> => {
    const flat = flatten(await targetsApi(client).tree().catch(() => []))
    setTargets(flat)
    return flat
  }, [client])

  const openRun = async (): Promise<void> => {
    if (hasErrors) {
      onInvalid()
      return
    }
    setOpening(true)
    try {
      const flat = await loadTargets()
      setTargetId(flat[0]?.id)
      setRunOpen(true)
    } finally {
      setOpening(false)
    }
  }

  const run = async (): Promise<void> => {
    setStarting(true)
    let id: string | undefined
    try {
      id = await save()
    } finally {
      setStarting(false)
    }
    if (id === undefined || targetId === undefined) return
    // Baseline the live-status stream to this run and clear any rings/output a
    // previous run left behind so only this run's frames repaint the canvas.
    setRunSeq(latestSeq(events))
    setStepExec(null)
    setSingleRun(null)
    // Clearing status/output is non-structural; the history recorder ignores it.
    setNodes((cur) =>
      cur.map((n) => {
        if (n.data.status === undefined && n.data.output === undefined) return n
        const { status: _s, output: _o, ...rest } = n.data
        return { ...n, data: rest }
      }),
    )
    setRunOpen(false)
    const stepped = stepMode
    setRunning(true)
    try {
      const result = (await exApi.runWorkflow(id, {
        targetId,
        ...(stepped ? { mode: 'step' as const } : {}),
        ...(backendId !== 'local' ? { backendProfileId: backendId } : {}),
      })) as { status?: string; executionId?: string }
      if (stepped && result.executionId !== undefined) {
        setStepExec(result.executionId)
        notify('Stepping. Press Next to advance.')
      } else {
        if (result.status === 'failed') notify.error(runSummaryMessage('failed', null))
        else if (result.status === 'cancelled' || result.executionId === undefined) notify('Run complete')
        else {
          const summary = await exApi.summary(result.executionId).catch(() => null)
          notify(runSummaryMessage(result.status, summary))
        }
      }
    } catch {
      notify.error('Run failed to start')
    } finally {
      setRunning(false)
    }
  }

  const stepNext = async (): Promise<void> => {
    if (stepExec === null) return
    setStepping(true)
    await exApi.step(stepExec).catch(() => notify.error('Step failed'))
    setStepping(false)
  }

  const stepResume = async (): Promise<void> => {
    if (stepExec === null) return
    const id = stepExec
    setStepExec(null)
    await exApi.resume(id).catch(() => notify.error('Resume failed'))
  }

  // Run just one node against the current run target via the single-node path.
  const runSingleNode = useCallback(
    async (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (node === undefined) return
      let tId = targetId
      if (tId === undefined) {
        tId = (await loadTargets())[0]?.id
        setTargetId(tId)
      }
      if (tId === undefined) {
        notify('Add a target first to run a node')
        return
      }
      const baseline = latestSeq(events)
      // Optimistic status only (not structural), so no history guard is needed.
      setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, status: 'running' } } : n)))
      try {
        const res = (await nodesApi(client).run(node.data.nodeType, {
          targetId: tId,
          params: node.data.params,
        })) as { executionId?: string }
        if (res.executionId !== undefined) {
          setSingleRun({ instanceId: id, execId: res.executionId, nodeType: node.data.nodeType, sinceSeq: baseline })
        }
      } catch {
        setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, status: 'error' } } : n)))
        notify.error('Node run failed to start')
      }
    },
    [nodes, targetId, client, events, setNodes, loadTargets],
  )

  return {
    runOpen,
    closeRun: () => setRunOpen(false),
    targets,
    targetId,
    setTargetId,
    stepMode,
    setStepMode,
    stepExec,
    runSeq,
    singleRun,
    opening,
    starting,
    running,
    stepping,
    openRun,
    run,
    stepNext,
    stepResume,
    runSingleNode,
  }
}
