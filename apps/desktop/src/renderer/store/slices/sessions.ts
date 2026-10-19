import { terminalsApi } from '../../api/terminals.js'
import { isTeamAgent } from '../../api/teams.js'
import { tabMetaKey } from '../helpers.js'
import type { AppState } from '../types.js'
import type { SliceCtx } from './context.js'

const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastActivityAt = new Map<string, number>()
/** Continuous output within this gap counts as the agent actively streaming. */
const STREAM_GAP_MS = 450
/** Drop back to idle after this much quiet. */
const IDLE_AFTER_MS = 1000

/** Agent/terminal sessions: create, close, select, and the idle/working pulse. */
export function createSessionsSlice(ctx: SliceCtx): Pick<AppState, 'createSession' | 'closeSession' | 'setActiveSession' | 'pulseSession'> {
  const { set, get, patchActive, persistSessions, persistTabMeta } = ctx

  return {
    createSession: async (spec) => {
      const client = get().client
      if (client === null) return
      const agent = 'agent' in spec ? spec.agent : 'shell'
      try {
        const { id } = await terminalsApi(client).create(spec)
        const n = get().sessions.length + 1
        const label =
          agent === 'shell' ? `terminal ${n}` : isTeamAgent(agent) ? `claude team ${n}` : `${agent} ${n}`
        patchActive((e) => ({
          ...e,
          sessions: [...e.sessions, { id, label, agent }],
          activeSessionId: id,
          activeTab: { kind: 'terminal', id },
        }))
        persistSessions(get().activeRoot)
        set({ activeView: 'terminals' })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    // Only a user-initiated close removes a session from the persisted set, so
    // it does not come back on the next restart.
    closeSession: (id) => {
      patchActive((e) => {
        const sessions = e.sessions.filter((x) => x.id !== id)
        const { [id]: _drop, ...rest } = e.sessionState
        const activeSessionId =
          e.activeSessionId === id ? (sessions[sessions.length - 1]?.id ?? null) : e.activeSessionId
        // If the closed terminal was the workspace's active tab, fall back to the
        // next terminal, then to a file tab, then to nothing.
        let activeTab = e.activeTab
        if (e.activeTab?.kind === 'terminal' && e.activeTab.id === id) {
          activeTab = activeSessionId
            ? { kind: 'terminal', id: activeSessionId }
            : e.files.length > 0
              ? { kind: 'file', id: e.files[e.files.length - 1]!.id }
              : null
        }
        const { [tabMetaKey({ kind: 'terminal', id })]: _dropMeta, ...tabMeta } = e.tabMeta
        return { ...e, sessions, sessionState: rest, activeSessionId, activeTab, tabMeta }
      })
      persistSessions(get().activeRoot)
      persistTabMeta(get().activeRoot)
    },

    setActiveSession: (id) =>
      patchActive((e) => ({ ...e, activeSessionId: id, activeTab: { kind: 'terminal', id } })),

    pulseSession: (id) => {
      const now = Date.now()
      const prev = lastActivityAt.get(id)
      lastActivityAt.set(id, now)
      // Only sustained/continuous output (a real stream) counts as "working";
      // an isolated TUI repaint after a gap is ignored so an idle agent does
      // not flash.
      if (prev !== undefined && now - prev < STREAM_GAP_MS) {
        patchActive((e) => (e.sessionState[id] === 'working' ? e : { ...e, sessionState: { ...e.sessionState, [id]: 'working' } }))
      }
      const existing = pulseTimers.get(id)
      if (existing !== undefined) clearTimeout(existing)
      pulseTimers.set(
        id,
        setTimeout(() => {
          pulseTimers.delete(id)
          lastActivityAt.delete(id)
          patchActive((e) => ({ ...e, sessionState: { ...e.sessionState, [id]: 'idle' } }))
        }, IDLE_AFTER_MS),
      )
    },
  }
}
