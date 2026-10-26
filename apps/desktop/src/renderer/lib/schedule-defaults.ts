import type { Graph } from './graph-types.js'

const TARGET_KINDS = new Set(['domain', 'subdomain', 'ip', 'cidr', 'url'])

/** What a workflow's trigger node says about how it should be scheduled. */
export type ScheduleDefaults =
  | { kind: 'interval'; intervalSeconds: number }
  | { kind: 'on_create'; targetKind: string }

/**
 * Read the Schedule Trigger / On Create Trigger node of a workflow so the
 * Schedules dialog can prefill a new schedule from it. Trigger nodes never arm
 * anything themselves: workflows are user-level while schedules belong to one
 * engagement, so arming from the graph would fire the workflow in every
 * engagement. Returns undefined when the workflow has no such trigger.
 */
export function scheduleDefaultsFromGraph(graph: Graph): ScheduleDefaults | undefined {
  for (const node of graph.nodes) {
    if (node.type === 'schedule') {
      const seconds = Number(node.data.interval_seconds ?? 3600)
      return { kind: 'interval', intervalSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 3600 }
    }
    if (node.type === 'on_create') {
      const targetKind = String(node.data.target_kind ?? 'domain')
      return { kind: 'on_create', targetKind: TARGET_KINDS.has(targetKind) ? targetKind : 'domain' }
    }
  }
  return undefined
}
