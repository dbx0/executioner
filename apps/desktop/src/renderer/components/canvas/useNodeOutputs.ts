import type { EngineEvent } from '../../lib/events.js'

/**
 * The most output text retained per node. Older text is dropped from the front
 * so a long-running node cannot grow its captured buffer without bound.
 */
export const MAX_OUTPUT_CHARS = 20000

/**
 * Reduces the engine event stream to each node's latest captured output text,
 * keyed by nodeId. Concatenates `stdout` frames (in seq order) per node; only
 * frames with seq > sinceSeq are folded so a fresh run does not inherit prior
 * output (same scoping idiom as reduceNodeStatus). Ignores non-stdout frames.
 * The accumulated text per node is capped to the last MAX_OUTPUT_CHARS chars.
 */
export function reduceNodeOutputs(events: EngineEvent[], sinceSeq = 0): Record<string, string> {
  const outputs: Record<string, string> = {}
  for (const event of events) {
    if (event.seq <= sinceSeq) continue
    if (event.type !== 'stdout') continue
    const next = (outputs[event.nodeId] ?? '') + event.data
    outputs[event.nodeId] = next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next
  }
  return outputs
}
