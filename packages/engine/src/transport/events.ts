export type EngineEventType = 'status' | 'stdout' | 'stderr' | 'done' | 'agent' | 'change'

export interface EngineEventInput {
  type: EngineEventType
  executionId: string
  nodeId: string
  data: string
}

export interface EngineEvent extends EngineEventInput {
  seq: number
  at: string
}

export type EventListener = (event: EngineEvent) => void

/**
 * Replaces the Redis pub/sub layer of the previous architecture. The message
 * vocabulary is deliberately unchanged so the renderer's streaming code and the
 * graph engine in plan 3 can adopt it without translation.
 */
export class EventBus {
  private seq = 0
  private readonly listeners = new Set<EventListener>()

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(input: EngineEventInput): EngineEvent {
    this.seq += 1
    const event: EngineEvent = { ...input, seq: this.seq, at: new Date().toISOString() }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A broken subscriber, typically a socket that closed mid-write, must
        // not stop delivery to the rest or abort the caller's execution.
      }
    }
    return event
  }
}
