import type { EngineEvent } from '../../lib/events.js'

export type NodeStatus = 'running' | 'success' | 'error'

/**
 * Reduces the engine event stream to the latest visual status per graph node id.
 *
 * The engine signals a node is running with a `status` event carrying `running`,
 * and its terminal outcome with a `done` event carrying the execution status
 * vocabulary (`succeeded` / `failed` / `timeout`). Those map to the three border
 * states the canvas paints. Other events (stdout/stderr, exit-code status frames)
 * are ignored.
 *
 * The engine's `/events` socket is a single global stream carrying every
 * execution's frames, and the renderer keeps a rolling buffer across runs. To
 * keep a fresh run's status from inheriting the previous run's rings, callers
 * pass `sinceSeq` — the highest event sequence seen the moment the run was
 * launched — so only frames produced by the current run are folded in.
 */
export function reduceNodeStatus(events: EngineEvent[], sinceSeq = 0): Record<string, NodeStatus> {
  const status: Record<string, NodeStatus> = {}
  for (const event of events) {
    if (event.seq <= sinceSeq) continue
    if (event.type === 'status' && event.data === 'running') {
      status[event.nodeId] = 'running'
    } else if (event.type === 'done') {
      status[event.nodeId] = event.data === 'succeeded' ? 'success' : 'error'
    }
  }
  return status
}
