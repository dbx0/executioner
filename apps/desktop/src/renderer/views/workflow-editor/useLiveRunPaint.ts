import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { Node } from 'reactflow'
import type { GraphNodeData } from '../../components/canvas/GraphNodes.js'
import { reduceNodeStatus } from '../../components/canvas/useNodeStatus.js'
import { reduceNodeOutputs } from '../../components/canvas/useNodeOutputs.js'
import type { useEngineEvents } from '../../lib/events.js'

type EngineEvents = ReturnType<typeof useEngineEvents>

/** A one-off single-node run ("Run this node"), painted onto its instance. */
export interface SingleRun {
  instanceId: string
  execId: string
  nodeType: string
  sinceSeq: number
}

/**
 * Paint live run status and captured output onto the canvas nodes as engine
 * events stream in. Status and output live outside the structural graph
 * signature, so these paints never reach the undo history.
 */
export function useLiveRunPaint({
  events,
  runSeq,
  singleRun,
  setNodes,
}: {
  events: EngineEvents
  /** Only frames after this sequence number belong to the current run. */
  runSeq: number
  singleRun: SingleRun | null
  setNodes: Dispatch<SetStateAction<Node<GraphNodeData>[]>>
}): void {
  // Scope live status to the current run: the engine's `/events` socket is a
  // single global stream and the renderer keeps a rolling buffer across runs,
  // so fold only frames produced after this run was launched (`runSeq`).
  const statusByNode = useMemo(() => reduceNodeStatus(events, runSeq), [events, runSeq])
  const outputsByNode = useMemo(() => reduceNodeOutputs(events, runSeq), [events, runSeq])

  // Both maps are keyed by graph-node id (workflow runs emit under the instance id).
  useEffect(() => {
    // Only rebuild a node whose painted status/output actually moved. A run
    // streams a batch of events every frame, and handing React Flow a fresh
    // array of fresh node objects each time re-renders the whole canvas 60
    // times a second, which is what makes anything else clicked during a run
    // feel stuck.
    setNodes((cur) => {
      let changed = false
      const next = cur.map((n) => {
        const status = statusByNode[n.id]
        const output = outputsByNode[n.id]
        if (status === undefined && output === undefined) return n
        if ((status === undefined || n.data.status === status) && (output === undefined || n.data.output === output)) {
          return n
        }
        changed = true
        return {
          ...n,
          data: {
            ...n.data,
            ...(status !== undefined ? { status } : {}),
            ...(output !== undefined ? { output } : {}),
          },
        }
      })
      return changed ? next : cur
    })
  }, [statusByNode, outputsByNode, setNodes])

  // A single-node run emits events under the node TYPE (the manifest id), not
  // the graph instance id, so paint that one instance directly.
  useEffect(() => {
    if (singleRun === null) return
    const { instanceId, execId, nodeType, sinceSeq } = singleRun
    let status: GraphNodeData['status'] | undefined
    let output = ''
    for (const e of events) {
      if (e.seq <= sinceSeq || e.executionId !== execId || e.nodeId !== nodeType) continue
      if (e.type === 'stdout') output += e.data
      else if (e.type === 'status' && e.data === 'running') status = 'running'
      else if (e.type === 'done') status = e.data === 'succeeded' ? 'success' : 'error'
    }
    setNodes((cur) => {
      let changed = false
      const next = cur.map((n) => {
        if (n.id !== instanceId) return n
        if ((status === undefined || n.data.status === status) && (output === '' || n.data.output === output)) return n
        changed = true
        return {
          ...n,
          data: {
            ...n.data,
            ...(status !== undefined ? { status } : {}),
            ...(output !== '' ? { output } : {}),
          },
        }
      })
      return changed ? next : cur
    })
  }, [singleRun, events, setNodes])
}
