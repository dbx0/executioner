import { create } from 'zustand'
import type { ToolProbeResult } from '../../api/tools.js'
import { eventsUrl, type EngineConnection } from '../../lib/connection.js'
import { parseEngineEvent, type EngineEvent } from '../../lib/events.js'
import type { ParamsOrigin } from './RunForm.js'
import type { LiveRun } from './OutputPane.js'
import { LOCAL } from './ConnectionPicker.js'

/**
 * The Tools page's state, kept outside the page so leaving it loses nothing.
 *
 * The page unmounts whenever another view is shown. Held in React state, the
 * picked tool, targets and connection went with it, and so did the event
 * socket: a run that finished while the user was elsewhere never reported its
 * end, and its output was gone. Here the form is kept per engagement, and one
 * subscription per engine keeps collecting tool output whether or not the page
 * is on screen.
 */

/** What the form and the output pane were showing, per engagement. */
export interface ToolsPage {
  query: string
  nodeId: string | null
  targetIds: string[]
  backendId: string
  params: Record<string, unknown>
  paramsOrigin: ParamsOrigin
  connectionNote: string | null
  live: LiveRun | null
}

export const EMPTY_PAGE: ToolsPage = {
  query: '',
  nodeId: null,
  targetIds: [],
  backendId: LOCAL,
  params: {},
  paramsOrigin: null,
  connectionNote: null,
  live: null,
}

/** One connection's install check: what is installed, or why we could not ask. */
export interface ProbeState {
  busy: boolean
  byProgram: Record<string, ToolProbeResult>
  error: string | null
}

/** One watched run's streamed output. */
export interface RunStream {
  chunks: string[]
  /** Characters held, so a chatty run is trimmed from the front. */
  size: number
}

/** Output kept per run; older text is dropped first. The full log is on disk. */
const MAX_RUN_CHARS = 200_000
/** Events for runs nobody watches yet, so a run's first lines survive the race
 *  between its process starting and the page learning its id. */
const MAX_PENDING = 300
/** Finished runs remembered per engagement. */
const MAX_FINISHED = 1000

interface PerEngagement {
  streams: Record<string, RunStream>
  pending: EngineEvent[]
  /** Final status by run id, for every run seen to finish. */
  finished: Record<string, string>
}

const EMPTY_ENGAGEMENT: PerEngagement = { streams: {}, pending: [], finished: {} }

interface ToolsStore {
  pages: Record<string, ToolsPage>
  runs: Record<string, PerEngagement>
  /** Install checks per engagement, then per connection. Kept, since asking a
   *  remote host is slow; Recheck drops one to ask again. */
  probes: Record<string, Record<string, ProbeState>>
  /** Change an engagement's install checks. */
  updateProbes: (root: string, fn: (probes: Record<string, ProbeState>) => Record<string, ProbeState>) => void
  /** Change an engagement's page state. */
  update: (root: string, fn: (page: ToolsPage) => ToolsPage) => void
  /** Start keeping a run's output, seeded with anything it already printed. */
  watch: (root: string, executionId: string) => void
  /** Take in events from an engine, in arrival order. */
  ingest: (root: string, events: EngineEvent[]) => void
}

function appendChunk(stream: RunStream | undefined, data: string): RunStream {
  const chunks = [...(stream?.chunks ?? []), data]
  let size = (stream?.size ?? 0) + data.length
  while (size > MAX_RUN_CHARS && chunks.length > 1) size -= chunks.shift()!.length
  return { chunks, size }
}

function trimFinished(finished: Record<string, string>): Record<string, string> {
  const keys = Object.keys(finished)
  if (keys.length <= MAX_FINISHED) return finished
  return Object.fromEntries(keys.slice(-MAX_FINISHED).map((k) => [k, finished[k]!]))
}

export const useToolsStore = create<ToolsStore>((set) => ({
  pages: {},
  runs: {},
  probes: {},

  updateProbes: (root, fn) => set((s) => ({ probes: { ...s.probes, [root]: fn(s.probes[root] ?? {}) } })),

  update: (root, fn) => set((s) => ({ pages: { ...s.pages, [root]: fn(s.pages[root] ?? EMPTY_PAGE) } })),

  watch: (root, executionId) =>
    set((s) => {
      const runs = s.runs[root] ?? EMPTY_ENGAGEMENT
      if (runs.streams[executionId] !== undefined) return s
      let stream: RunStream = { chunks: [], size: 0 }
      for (const e of runs.pending) {
        if (e.executionId === executionId && (e.type === 'stdout' || e.type === 'stderr')) {
          stream = appendChunk(stream, e.data)
        }
      }
      return {
        runs: {
          ...s.runs,
          [root]: {
            ...runs,
            streams: { ...runs.streams, [executionId]: stream },
            pending: runs.pending.filter((e) => e.executionId !== executionId),
          },
        },
      }
    }),

  ingest: (root, events) =>
    set((s) => {
      const runs = s.runs[root] ?? EMPTY_ENGAGEMENT
      const streams = { ...runs.streams }
      let pending = runs.pending
      let finished = runs.finished
      for (const e of events) {
        if (e.type === 'done') {
          finished = { ...finished, [e.executionId]: e.data }
        } else if (e.type === 'stdout' || e.type === 'stderr') {
          if (streams[e.executionId] !== undefined) streams[e.executionId] = appendChunk(streams[e.executionId], e.data)
          else pending = [...pending, e]
        }
      }
      if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING)
      return { runs: { ...s.runs, [root]: { streams, pending, finished: trimFinished(finished) } } }
    }),
}))

/** Forget every engagement's state; for tests. */
export function resetToolsStore(): void {
  useToolsStore.setState({ pages: {}, runs: {}, probes: {} })
}

/** The open subscription per engagement, and the engine it points at. */
const sockets = new Map<string, { key: string; socket: WebSocket }>()

/**
 * Keep listening to this engagement's engine for tool output, page or no page.
 * Idempotent per engine: a page mounting again reuses the open socket, and a
 * restarted engine (new port or token) replaces it.
 */
export function subscribeToolEvents(connection: EngineConnection): void {
  const root = connection.projectRoot
  const key = `${connection.port}:${connection.token}`
  const open = sockets.get(root)
  if (open !== undefined && open.key === key && open.socket.readyState <= WebSocket.OPEN) return
  open?.socket.close()

  const socket = new WebSocket(eventsUrl(connection))
  sockets.set(root, { key, socket })
  // Coalesced so a flood of output is one store update rather than hundreds.
  // A timer, not an animation frame: frames stop while the window is hidden,
  // and a run that ends then must still be heard ending.
  let buffer: EngineEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const batch = buffer
    buffer = []
    if (batch.length > 0) useToolsStore.getState().ingest(root, batch)
  }
  socket.onmessage = (message) => {
    const event = parseEngineEvent(String(message.data))
    if (event === undefined) return
    buffer.push(event)
    timer ??= setTimeout(flush, 50)
  }
  socket.onclose = () => {
    if (timer !== null) clearTimeout(timer)
    flush()
    if (sockets.get(root)?.socket === socket) sockets.delete(root)
  }
}
