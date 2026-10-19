import { closeSync, openSync, readSync, statSync, watchFile, unwatchFile } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { EventBus } from '../transport/events.js'

interface WatchState {
  path: string
  /** The top-level execution/session id every event for this tree publishes under. */
  sessionId: string
  /** Session-level `…/<uuid>/subagents` dir. Claude writes every subagent
   *  transcript (at any depth) flat into this one directory, so it is derived
   *  once from the lead transcript and shared by every nested watch. */
  subagentsDir: string
  /** The tool-use-id of the sub-agent whose transcript this is — the id the
   *  store tracks that sub-agent under. Any sub-agent discovered in this
   *  transcript is its child, so this becomes the child's `parentId`.
   *  Undefined for the lead transcript (its children are top-level). */
  ownerId: string | undefined
  /** 0 for the lead; +1 per nesting level. Caps runaway recursion. */
  depth: number
  offset: number
  buffer: string
  seenStart: Set<string>
  seenStop: Set<string>
  /** tool-use-id → task-id (the child agent id / transcript filename stem),
   *  learned from `<task-notification>` records that name both. */
  taskIdByToolUse: Map<string, string>
  /** tool-use-ids we have already spun a child watch for (dedupe / cycle guard). */
  childWatched: Set<string>
}

/** Task statuses that mean a sub-agent has truly finished. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped'])

/** Belt-and-suspenders cap on nesting depth so a pathological transcript can
 *  never open an unbounded chain of watches. */
const MAX_SUBAGENT_DEPTH = 12

/**
 * Background sub-agents (the "Agent"/"Task" tool) do not fire Claude hooks, but
 * they ARE recorded in the session transcript. We learn a session's transcript
 * path from the hooks that DO fire (UserPromptSubmit/Stop) and tail the JSONL.
 *
 * Lifecycle, as read from a Claude transcript:
 *  - START: an assistant `tool_use` block named Agent/Task → the sub-agent is
 *    now *working*.
 *  - The immediate `tool_result` for that call is only a launch acknowledgement
 *    (`async_launched` / `teammate_spawned` / "Spawned successfully…"). It is
 *    NOT completion and is deliberately ignored — treating it as done is what
 *    made a running sub-agent show a checkmark.
 *  - STOP: a later `<task-notification>` record carrying the same
 *    `<tool-use-id>` and a terminal `<status>` (completed/failed/killed/stopped).
 *    Interim notifications (running) are ignored; the terminal one wins.
 *
 * NESTED lineage. A sub-agent's OWN sub-agents are recorded in the CHILD's
 * transcript, not the lead's. Claude writes every subagent transcript flat into
 * `…/<uuid>/subagents/agent-<agentId>.jsonl` and each `<task-notification>`
 * names both the parent's `<tool-use-id>` and the child's `<task-id>` (which IS
 * that `<agentId>` / filename stem). So when a sub-agent is discovered we learn
 * its agent-id from the first notification and ALSO tail its transcript,
 * emitting its sub-agents tagged with a `parentId` linking child → parent (the
 * parent's tool-use-id). This recurses to arbitrary depth.
 */
export class TranscriptWatchers {
  /** Keyed by transcript path (unique) so lead + nested watches coexist. */
  private readonly watched = new Map<string, WatchState>()

  constructor(private readonly bus: EventBus) {}

  /** Begin tailing a lead session's `transcriptPath` (idempotent per path). */
  observe(sessionId: string, transcriptPath: string): void {
    const stem = basename(transcriptPath, extname(transcriptPath))
    const subagentsDir = join(dirname(transcriptPath), stem, 'subagents')
    this.watchPath({
      path: transcriptPath,
      sessionId,
      subagentsDir,
      ownerId: undefined,
      depth: 0,
    })
  }

  /** Stop every watch (lead + nested) belonging to a session. */
  stop(sessionId: string): void {
    for (const [path, state] of this.watched) {
      if (state.sessionId !== sessionId) continue
      unwatchFile(state.path)
      this.watched.delete(path)
    }
  }

  private watchPath(cfg: {
    path: string
    sessionId: string
    subagentsDir: string
    ownerId: string | undefined
    depth: number
  }): void {
    if (this.watched.has(cfg.path)) return
    const state: WatchState = {
      path: cfg.path,
      sessionId: cfg.sessionId,
      subagentsDir: cfg.subagentsDir,
      ownerId: cfg.ownerId,
      depth: cfg.depth,
      offset: 0,
      buffer: '',
      seenStart: new Set(),
      seenStop: new Set(),
      taskIdByToolUse: new Map(),
      childWatched: new Set(),
    }
    this.watched.set(cfg.path, state)
    this.scan(cfg.path)
    // watchFile tolerates a not-yet-created file and fires once it appears, so a
    // child transcript discovered before Claude has flushed it is still tailed.
    watchFile(cfg.path, { interval: 500 }, () => this.scan(cfg.path))
  }

  private scan(path: string): void {
    const state = this.watched.get(path)
    if (state === undefined) return
    let size: number
    try {
      size = statSync(state.path).size
    } catch {
      return
    }
    if (size < state.offset) state.offset = 0 // rotated/truncated
    if (size === state.offset) return

    let text: string
    try {
      const fd = openSync(state.path, 'r')
      const buf = Buffer.alloc(size - state.offset)
      readSync(fd, buf, 0, buf.length, state.offset)
      closeSync(fd)
      text = buf.toString('utf8')
    } catch {
      return
    }
    state.offset = size
    state.buffer += text
    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() ?? ''
    for (const line of lines) this.processLine(state, line)
  }

  private processLine(state: WatchState, line: string): void {
    if (line.trim() === '') return
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      return
    }

    // Content can live at entry.content or entry.message.content, and can be an
    // array of blocks (assistant tool_use / user tool_result) or a plain string
    // (the injected <task-notification> user messages).
    const e = entry as { content?: unknown; message?: { content?: unknown } }
    for (const content of [e.message?.content, e.content]) {
      if (typeof content === 'string') {
        this.handleNotification(state, content)
      } else if (Array.isArray(content)) {
        for (const raw of content) {
          const item = raw as {
            type?: string
            name?: string
            id?: string
            input?: Record<string, unknown>
            text?: unknown
          }
          this.handleStart(state, item)
          if (typeof item.text === 'string') this.handleNotification(state, item.text)
        }
      }
    }
  }

  /** An Agent/Task tool_use block: the sub-agent has started working. */
  private handleStart(
    state: WatchState,
    item: { type?: string; name?: string; id?: string; input?: Record<string, unknown> },
  ): void {
    if (item.type !== 'tool_use') return
    if (item.name !== 'Agent' && item.name !== 'Task') return
    if (typeof item.id !== 'string' || state.seenStart.has(item.id)) return
    state.seenStart.add(item.id)
    const input = item.input ?? {}
    const description = String(input.description ?? input.subagent_type ?? input.prompt ?? 'sub-agent').slice(0, 80)
    this.publishSubagentEvent(state, 'subagent-start', { id: item.id, description })
    // A notification may already have taught us this child's agent-id; if so,
    // start tailing its transcript now (otherwise handleNotification will).
    const taskId = state.taskIdByToolUse.get(item.id)
    if (taskId !== undefined) this.maybeWatchChild(state, item.id, taskId)
  }

  /** A <task-notification> string. Learns the tool-use-id → task-id (child
   *  agent-id) mapping to tail the child transcript, and emits stop only on a
   *  terminal status. */
  private handleNotification(state: WatchState, text: string): void {
    if (!text.includes('<task-notification>')) return
    const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1]?.trim()
    if (toolUseId === undefined) return
    const taskId = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim()
    if (taskId !== undefined && taskId !== '') {
      state.taskIdByToolUse.set(toolUseId, taskId)
      // Only tail a child we actually saw start, so a stray notification can't
      // conjure a phantom watch.
      if (state.seenStart.has(toolUseId)) this.maybeWatchChild(state, toolUseId, taskId)
    }
    const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim()
    if (status === undefined) return
    if (!TERMINAL_STATUSES.has(status)) return // running / interim — still working
    if (!state.seenStart.has(toolUseId) || state.seenStop.has(toolUseId)) return
    state.seenStop.add(toolUseId)
    this.publishSubagentEvent(state, 'subagent-stop', { id: toolUseId, status })
  }

  /** Tail a discovered sub-agent's own transcript so ITS sub-agents surface,
   *  each tagged with this sub-agent's id as `parentId`. */
  private maybeWatchChild(state: WatchState, toolUseId: string, taskId: string): void {
    if (state.depth + 1 > MAX_SUBAGENT_DEPTH) return
    if (state.childWatched.has(toolUseId)) return
    state.childWatched.add(toolUseId)
    const childPath = join(state.subagentsDir, `agent-${taskId}.jsonl`)
    this.watchPath({
      path: childPath,
      sessionId: state.sessionId,
      subagentsDir: state.subagentsDir,
      ownerId: toolUseId,
      depth: state.depth + 1,
    })
  }

  private publishSubagentEvent(
    state: WatchState,
    nodeId: 'subagent-start' | 'subagent-stop',
    fields: { id: string; description?: string; status?: string },
  ): void {
    const data: Record<string, unknown> = { ...fields }
    // exactOptionalPropertyTypes: only attach parentId when this transcript
    // belongs to a sub-agent (the lead's children are top-level).
    if (state.ownerId !== undefined) data.parentId = state.ownerId
    this.bus.publish({
      type: 'agent',
      executionId: state.sessionId,
      nodeId,
      data: JSON.stringify(data),
    })
  }
}
