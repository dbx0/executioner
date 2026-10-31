import { randomUUID } from 'node:crypto'
import type { EventBus } from '../transport/events.js'

export interface BrowserItem {
  id: string
  owner: string | null
  url: string
  title: string
}

export type BrowserEventName = 'opened' | 'owner' | 'closed' | 'activity'

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

/** The engine's view of the embedded browsers the renderer has registered. */
export class BrowserRegistry {
  private readonly items = new Map<string, BrowserItem>()

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
    this.publish('closed', item)
  }

  activity(id: string, active: boolean): void {
    const item = this.items.get(id)
    if (item !== undefined) this.publish('activity', item, { active })
  }
}
