import { useEffect, useState } from 'react'
import { eventsUrl, type EngineConnection } from './connection.js'

export interface EngineEvent {
  type: 'status' | 'stdout' | 'stderr' | 'done' | 'agent'
  executionId: string
  nodeId: string
  data: string
  seq: number
  at: string
}

const TYPES = new Set(['status', 'stdout', 'stderr', 'done', 'agent'])

export function parseEngineEvent(raw: string): EngineEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const e = parsed as Record<string, unknown>
  if (
    typeof e.type !== 'string' ||
    !TYPES.has(e.type) ||
    typeof e.executionId !== 'string' ||
    typeof e.nodeId !== 'string' ||
    typeof e.data !== 'string' ||
    typeof e.seq !== 'number'
  ) {
    return undefined
  }
  return {
    type: e.type as EngineEvent['type'],
    executionId: e.executionId,
    nodeId: e.nodeId,
    data: e.data,
    seq: e.seq,
    at: typeof e.at === 'string' ? e.at : '',
  }
}

/** Subscribes to the engine event stream, keeping the most recent `limit` events.
 *
 * Incoming messages are COALESCED into one React state update per animation
 * frame. A running workflow can stream stdout faster than React can render, and
 * setting state per message would recompute node status over the whole buffer on
 * every frame's worth of events at once — enough to freeze the canvas. Buffering
 * and flushing on rAF collapses a burst into a single update. */
export function useEngineEvents(connection: EngineConnection | undefined, limit = 500): EngineEvent[] {
  const [events, setEvents] = useState<EngineEvent[]>([])

  useEffect(() => {
    if (connection === undefined) return
    const socket = new WebSocket(eventsUrl(connection))
    let buffer: EngineEvent[] = []
    let raf = 0
    const flush = (): void => {
      raf = 0
      if (buffer.length === 0) return
      const batch = buffer
      buffer = []
      setEvents((prev) => [...prev, ...batch].slice(-limit))
    }
    socket.onmessage = (message) => {
      const event = parseEngineEvent(String(message.data))
      if (event === undefined) return
      buffer.push(event)
      // Bound the buffer in case rAF is paused (hidden window) during a flood.
      if (buffer.length > limit) buffer = buffer.slice(-limit)
      if (raf === 0) raf = requestAnimationFrame(flush)
    }
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      socket.close()
    }
  }, [connection, limit])

  return events
}
