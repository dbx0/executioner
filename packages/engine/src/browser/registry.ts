import { randomUUID } from 'node:crypto'
import type { EventBus } from '../transport/events.js'

export interface BrowserItem {
  id: string
  owner: string | null
  url: string
  title: string
  /** Set while an agent waits on the operator through browser_ask_operator. */
  ask?: PendingAsk
}

export interface PendingAsk {
  message: string
  askedAt: number
}

/** How a wait on the operator ended. A timeout leaves the ask pending. */
export type AskAnswer = { answered: true; reply?: string } | { answered: false; reason: 'timeout' | 'closed' }

export type BrowserEventName = 'opened' | 'owner' | 'closed' | 'activity' | 'ask' | 'answered'

export type BrowserPublish = (event: BrowserEventName, item: BrowserItem, extra?: Record<string, unknown>) => void

/** A publisher that puts browser events on the engine bus for the renderer. */
export function busBrowserPublisher(bus: EventBus): BrowserPublish {
  return (event, item, extra) => {
    bus.publish({
      type: 'browser',
      executionId: item.id,
      nodeId: event,
      data: JSON.stringify({ ...item, ...extra }),
    })
  }
}

/** How long an answer nobody was waiting for stays claimable. */
const UNCLAIMED_ANSWER_MS = 30 * 60_000

/** The engine's view of the embedded browsers the renderer has registered. */
export class BrowserRegistry {
  private readonly items = new Map<string, BrowserItem>()
  /** Everyone waiting on each browser's pending ask. */
  private readonly waiters = new Map<string, Set<(answer: AskAnswer) => void>>()
  /** Answers given while no agent was waiting, kept for the agent's next ask with the same message. */
  private readonly unclaimed = new Map<string, { answer: AskAnswer; message: string; at: number }>()

  constructor(private readonly publish: BrowserPublish) {}

  list(): BrowserItem[] {
    return [...this.items.values()]
  }

  create(opts: { id?: string; owner?: string | null; url?: string; title?: string }): BrowserItem {
    const item: BrowserItem = {
      id: opts.id ?? randomUUID(),
      owner: opts.owner ?? null,
      url: opts.url ?? '',
      title: opts.title ?? '',
    }
    this.items.set(item.id, item)
    this.publish('opened', item)
    return item
  }

  get(id: string): BrowserItem | undefined {
    return this.items.get(id)
  }

  ownedBy(sessionId: string): BrowserItem | undefined {
    return this.list().find((item) => item.owner === sessionId)
  }

  /**
   * The browser a session drives: its own, else one nobody drives (such as one the operator
   * opened, or one restored after a restart), else a new one.
   */
  browserFor(sessionId: string): BrowserItem {
    const own = this.ownedBy(sessionId)
    if (own !== undefined) return own
    const free = this.list().find((item) => item.owner === null)
    return free !== undefined ? this.setOwner(free.id, sessionId) : this.create({ owner: sessionId })
  }

  /** A session owns at most one browser, so its previous one is released. */
  setOwner(id: string, owner: string | null): BrowserItem {
    const item = this.items.get(id)
    if (item === undefined) throw new Error(`unknown browser: ${id}`)
    if (owner !== null) {
      const previous = this.ownedBy(owner)
      if (previous !== undefined && previous.id !== id) {
        previous.owner = null
        this.publish('owner', previous)
      }
    }
    item.owner = owner
    this.publish('owner', item)
    return item
  }

  update(id: string, patch: { url?: string; title?: string }): void {
    const item = this.items.get(id)
    if (item === undefined) return
    if (patch.url !== undefined) item.url = patch.url
    if (patch.title !== undefined) item.title = patch.title
  }

  remove(id: string): void {
    const item = this.items.get(id)
    if (item === undefined) return
    this.items.delete(id)
    delete item.ask
    this.unclaimed.delete(id)
    this.settle(id, { answered: false, reason: 'closed' })
    this.publish('closed', item)
  }

  activity(id: string, active: boolean): void {
    const item = this.items.get(id)
    if (item !== undefined) this.publish('activity', item, { active })
  }

  /**
   * Tell the operator the agent needs them and wait for their answer. An ask
   * already pending on the browser is joined rather than notified again; a new
   * message replaces the old one. Aborting the signal stops only this wait and
   * resolves it as a timeout, leaving the ask pending. An answer the operator
   * gave while nobody was waiting is returned straight away, but only to an ask
   * with the message they answered: a different message is a new question.
   */
  ask(id: string, message: string, signal?: AbortSignal): Promise<AskAnswer> {
    const item = this.items.get(id)
    if (item === undefined) return Promise.resolve({ answered: false, reason: 'closed' })
    const kept = this.unclaimed.get(id)
    this.unclaimed.delete(id)
    if (kept !== undefined && kept.message === message && Date.now() - kept.at <= UNCLAIMED_ANSWER_MS) {
      return Promise.resolve(kept.answer)
    }
    if (item.ask === undefined) {
      item.ask = { message, askedAt: Date.now() }
      this.publish('ask', item, { message })
    } else if (item.ask.message !== message) {
      item.ask = { ...item.ask, message }
      this.publish('ask', item, { message })
    }
    return new Promise<AskAnswer>((resolve) => {
      let set = this.waiters.get(id)
      if (set === undefined) {
        set = new Set()
        this.waiters.set(id, set)
      }
      const waiters = set
      const done = (answer: AskAnswer): void => {
        waiters.delete(done)
        signal?.removeEventListener('abort', onAbort)
        resolve(answer)
      }
      const onAbort = (): void => done({ answered: false, reason: 'timeout' })
      waiters.add(done)
      if (signal?.aborted === true) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** The operator's answer to a pending ask. False when nothing was pending. */
  answer(id: string, reply?: string): boolean {
    const item = this.items.get(id)
    if (item?.ask === undefined) return false
    const message = item.ask.message
    delete item.ask
    const answer: AskAnswer = reply === undefined ? { answered: true } : { answered: true, reply }
    // The agent's wait may have ended (its client gave up) before the operator
    // finished; keep the answer for its next call instead of dropping it.
    if ((this.waiters.get(id)?.size ?? 0) === 0) this.unclaimed.set(id, { answer, message, at: Date.now() })
    else this.settle(id, answer)
    this.publish('answered', item)
    return true
  }

  private settle(id: string, answer: AskAnswer): void {
    const waiters = this.waiters.get(id)
    this.waiters.delete(id)
    for (const done of [...(waiters ?? [])]) done(answer)
  }
}
