import { agentsApi } from '../../api/agents.js'
import { transcriptStem } from '../helpers.js'
import type { AppState, ScopeRunState, Subagent } from '../types.js'
import type { SliceCtx } from './context.js'

/** How long a finished sub-agent lingers (checkmark) before it ages out. */
const SUBAGENT_REAP_MS = 8000
const subagentReapTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Installed-agent discovery and the agent lifecycle/sub-agent event reducer. */
export function createAgentsSlice(ctx: SliceCtx): Pick<AppState, 'refreshAgents' | 'handleAgentEvent'> {
  const { set, get, patchActive, persistSessions } = ctx

  /** After a finished sub-agent has shown its checkmark, drop it from the list. */
  const scheduleSubagentReap = (sessionId: string, id: string): void => {
    const key = `${sessionId}:${id}`
    const existing = subagentReapTimers.get(key)
    if (existing !== undefined) clearTimeout(existing)
    subagentReapTimers.set(
      key,
      setTimeout(() => {
        subagentReapTimers.delete(key)
        patchActive((e) => {
          const list = e.subagents[sessionId]
          if (list === undefined) return e
          const nextList = list.filter((x) => x.id !== id)
          if (nextList.length === list.length) return e
          return { ...e, subagents: { ...e.subagents, [sessionId]: nextList } }
        })
      }, SUBAGENT_REAP_MS),
    )
  }

  return {
    refreshAgents: () => {
      const client = get().client
      if (client === null) return
      void agentsApi(client)
        .list()
        .then((rows) => set({ installedAgents: rows.filter((r) => r.installed).map((r) => r.id) }))
        .catch(() => undefined)
    },

    handleAgentEvent: (sessionId, event, payload) => {
      // "Start with AI" scope-parse progress streams under a runId that is not a
      // terminal session, so it must be routed to the scopeRuns slice and return
      // BEFORE the session-scoped reducer below (which drops unknown ids).
      if (event === 'scope-progress' || event === 'scope-done') {
        set((state) => {
          const prev = state.scopeRuns[sessionId] ?? { bubbles: [], done: false }
          if (event === 'scope-progress') {
            const message = String((payload as { message?: unknown }).message ?? '')
            if (message === '') return {}
            const nextId = (prev.bubbles[prev.bubbles.length - 1]?.id ?? 0) + 1
            return {
              scopeRuns: {
                ...state.scopeRuns,
                [sessionId]: { ...prev, bubbles: [...prev.bubbles, { id: nextId, message }] },
              },
            }
          }
          // scope-done
          const isError = (payload as { error?: unknown }).error === true
          const rawTargets = (payload as { targets?: unknown }).targets
          const targets = Array.isArray(rawTargets) ? (rawTargets as { kind: string; value: string }[]) : []
          const done: ScopeRunState = {
            ...prev,
            done: true,
            ...(isError ? { error: true } : {}),
            ...(isError
              ? {}
              : {
                  summary: {
                    total: Number((payload as { total?: unknown }).total ?? 0),
                    added: Number((payload as { added?: unknown }).added ?? 0),
                    targets,
                  },
                }),
          }
          return { scopeRuns: { ...state.scopeRuns, [sessionId]: done } }
        })
        return
      }

      const before = get().open.find((x) => x.root === get().activeRoot)?.sessions
      patchActive((e) => {
        if (!e.sessions.some((s) => s.id === sessionId)) return e
        let sessions = e.sessions
        let sessionState = e.sessionState
        let subagents = e.subagents

        // The lead agent's own state comes only from its own hooks — never from
        // sub-agent activity — so a child finishing can't flip the parent. The
        // sidebar keeps the parent "working" while any child still runs.
        if (event === 'UserPromptSubmit' || event === 'PreToolUse') {
          sessionState = { ...sessionState, [sessionId]: 'working' }
        } else if (event === 'Stop') {
          sessionState = { ...sessionState, [sessionId]: 'idle' }
        }

        // Learn the agent's own session id from its transcript path (the filename
        // stem is claude's session UUID) so a restart can resume this chat.
        const transcriptPath = (payload as { transcript_path?: unknown }).transcript_path
        if (typeof transcriptPath === 'string' && transcriptPath !== '') {
          const resume = transcriptStem(transcriptPath)
          if (resume !== '') {
            sessions = sessions.map((s) => (s.id === sessionId && s.resume !== resume ? { ...s, resume } : s))
          }
        }

        // Give the agent a real title from its first prompt (instead of "claude 1").
        if (event === 'UserPromptSubmit') {
          const prompt = String((payload as { prompt?: unknown }).prompt ?? '')
            .replace(/\s+/g, ' ')
            .trim()
          if (prompt !== '') {
            sessions = sessions.map((s) =>
              s.id === sessionId && (s.title === undefined || s.title === '')
                ? { ...s, title: prompt.slice(0, 60) }
                : s,
            )
          }
        }

        // Sub-agents are detected solely by the engine tailing the session
        // transcript (background sub-agents fire no hooks here). start = working;
        // stop fires only on the terminal task-notification, then the row ages out.
        if (event === 'subagent-start') {
          const id = String((payload as { id?: unknown }).id ?? `${Date.now()}-${Math.random()}`)
          const description = String((payload as { description?: unknown }).description ?? 'sub-agent')
          const rawParent = (payload as { parentId?: unknown }).parentId
          const parentId = typeof rawParent === 'string' && rawParent !== '' ? rawParent : undefined
          const list = subagents[sessionId] ?? []
          if (!list.some((x) => x.id === id)) {
            // exactOptionalPropertyTypes: attach parentId only when nested.
            const sub: Subagent = parentId === undefined ? { id, description, state: 'working' } : { id, description, state: 'working', parentId }
            subagents = { ...subagents, [sessionId]: [...list, sub] }
          }
        }
        if (event === 'subagent-stop') {
          const id = String((payload as { id?: unknown }).id ?? '')
          const list = subagents[sessionId] ?? []
          const idx = list.findIndex((x) => x.id === id)
          if (idx !== -1 && list[idx]!.state !== 'done') {
            const next = list.slice()
            next[idx] = { ...next[idx]!, state: 'done' }
            subagents = { ...subagents, [sessionId]: next }
            scheduleSubagentReap(sessionId, id)
          }
        }

        if (sessions === e.sessions && sessionState === e.sessionState && subagents === e.subagents) return e
        return { ...e, sessions, sessionState, subagents }
      })
      // Persist only when the durable session shape (title/resume) actually
      // changed, not on every high-frequency lifecycle tick.
      if (get().sessions !== before) persistSessions(get().activeRoot)
    },
  }
}
