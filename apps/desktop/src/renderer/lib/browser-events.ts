import { useEffect, useRef } from 'react'
import { useApp } from '../store.js'
import type { BrowserTab } from '../store/types.js'
import { eventsUrl, type EngineConnection } from './connection.js'
import { parseEngineEvent } from './events.js'

const BROWSER_EVENTS = new Set(['opened', 'owner', 'closed', 'activity', 'ask', 'answered'])
type BrowserEventName = 'opened' | 'owner' | 'closed' | 'activity' | 'ask' | 'answered'

const keyOf = (root: string, c: EngineConnection): string => `${root}\n${c.port}\n${c.token}`

/**
 * Follow the browser events of every open engagement, not only the active one: each holds its
 * own engine, and an agent in a background engagement asking for the operator must still raise
 * its toast and mark the engagement on the rail. Sockets open and close with the engagements, and
 * one engagement coming or going leaves the others' sockets alone so none misses an event.
 */
export function useBrowserEvents(): void {
  const open = useApp((s) => s.open)
  const sockets = useRef(new Map<string, WebSocket>())
  const key = open.map((e) => keyOf(e.root, e.connection)).join('\0')

  useEffect(() => {
    const live = sockets.current
    const wanted = new Map(useApp.getState().open.map((e) => [keyOf(e.root, e.connection), e] as const))
    for (const [k, ws] of live) {
      if (wanted.has(k)) continue
      ws.close()
      live.delete(k)
    }
    for (const [k, e] of wanted) {
      if (live.has(k)) continue
      const ws = new WebSocket(eventsUrl(e.connection))
      const root = e.root
      ws.onmessage = (m) => {
        const ev = parseEngineEvent(String(m.data))
        if (ev?.type !== 'browser' || !BROWSER_EVENTS.has(ev.nodeId)) return
        try {
          const item = JSON.parse(ev.data) as BrowserTab & { active?: boolean; message?: string }
          useApp.getState().handleBrowserEvent(ev.nodeId as BrowserEventName, item, root)
        } catch {
          /* ignore malformed payloads */
        }
      }
      live.set(k, ws)
    }
  }, [key])

  useEffect(() => {
    const live = sockets.current
    return () => {
      for (const ws of live.values()) ws.close()
      live.clear()
    }
  }, [])
}

/** Keep each browser's page in the store as main reports it, so a restart reopens it there. */
export function useBrowserPageTracking(): void {
  useEffect(() => {
    // Absent in tests and older preloads.
    const api = (window.executioner as Partial<Window['executioner']> | undefined)?.browser
    if (api === undefined) return
    return api.onState((e) => useApp.getState().trackBrowserPage(e.id, e.state.url, e.state.title))
  }, [])
}
