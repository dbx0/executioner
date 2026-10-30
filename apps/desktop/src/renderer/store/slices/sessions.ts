import { terminalsApi } from '../../api/terminals.js'
import { isTeamAgent } from '../../api/teams.js'
import type { AppState } from '../types.js'
import type { SliceCtx } from './context.js'
import { dropItem, healLayouts, placeItem, relayout } from './layouts.js'

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
    createSession: async (spec, opts) => {
      const client = get().client
      if (client === null) return
      const agent = 'agent' in spec ? spec.agent : 'shell'
      try {
        const { id } = await terminalsApi(client).create(spec)
        const n = get().sessions.length + 1
        const label =
          agent === 'shell' ? `terminal ${n}` : isTeamAgent(agent) ? `claude team ${n}` : `${agent} ${n}`
        patchActive((e) =>
          relayout(e, (x) =>
            placeItem(
              { ...x, sessions: [...x.sessions, { id, label, agent }], activeSessionId: id },
              { kind: 'terminal', id },
              opts?.into,
            ),
          ),
        )
        persistSessions(get().activeRoot)
        set({ activeView: 'terminals' })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    // Only a user-initiated close removes a session from the persisted set, so
    // it does not come back on the next restart.
    closeSession: (id) => {
      patchActive((e0) => {
        const e = healLayouts(e0)
        const sessions = e.sessions.filter((x) => x.id !== id)
        const { [id]: _drop, ...rest } = e.sessionState
        const activeSessionId =
          e.activeSessionId === id ? (sessions[sessions.length - 1]?.id ?? null) : e.activeSessionId
        // The pane goes with the session; the layout code picks what to show next.
        return relayout({ ...e, sessions, sessionState: rest, activeSessionId }, (x) =>
          dropItem(x, { kind: 'terminal', id }),
        )
      })
      persistSessions(get().activeRoot)
      persistTabMeta(get().activeRoot)
    },

    setActiveSession: (id) => get().setActiveTab({ kind: 'terminal', id }),

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
