import type { Cdp } from './cdp.js'
import type { ChromeLauncher } from './launch.js'
import { launchChrome } from './launch.js'
import { HostBrowserSession } from './session.js'
import {
  BROWSER_DARWIN_REQUIRED,
  type Bounds,
  type BrowserState,
  type BrowserStateEvent,
  type OperatorOp,
} from './types.js'

const key = (root: string, id: string): string => `${root}\0${id}`

export type StateListener = (e: BrowserStateEvent) => void

export interface HostBrowserManagerOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Inject a launcher (tests supply fake CDP). */
  launch?: ChromeLauncher
}

/**
 * Owns host Chromium windows, one CDP target per (engagement root, browser id).
 * Shares one Chromium process; each session opens a new window via Target.createTarget.
 */
export class HostBrowserManager {
  private readonly pages = new Map<string, HostBrowserSession>()
  private readonly creating = new Map<string, Promise<HostBrowserSession>>()
  private readonly placements = new Map<string, Bounds | null>()
  private readonly listeners = new Set<StateListener>()
  private cdp: Cdp | undefined
  private killChrome: (() => Promise<void>) | undefined
  private launching: Promise<Cdp> | undefined
  private occluded = false
  private readonly platform: NodeJS.Platform
  private readonly env: NodeJS.ProcessEnv
  private readonly launch: ChromeLauncher

  constructor(options: HostBrowserManagerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.env = options.env ?? process.env
    this.launch = options.launch ?? launchChrome
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  place(root: string, id: string, bounds: Bounds | null): void {
    this.assertDarwin()
    this.placements.set(key(root, id), bounds)
    const existing = this.pages.get(key(root, id))
    if (existing !== undefined) {
      void existing.place(bounds).catch(() => undefined)
      return
    }
    if (bounds === null) return
    void this.ensure(root, id)
      .then((page) => page.place(bounds))
      .catch(() => undefined)
  }

  setOccluded(occluded: boolean): void {
    this.assertDarwin()
    this.occluded = occluded
    for (const page of this.pages.values()) {
      void page.setOccluded(occluded).catch(() => undefined)
    }
  }

  async operator(root: string, id: string, op: OperatorOp): Promise<void> {
    this.assertDarwin()
    const page = await this.ensure(root, id)
    if (page.isDestroyed) return
    await page.operator(op)
  }

  close(root: string, id: string): void {
    this.assertDarwin()
    this.destroyKey(key(root, id))
  }

  closeRoot(root: string): void {
    const prefix = `${root}\0`
    for (const k of [...this.pages.keys(), ...this.creating.keys()]) {
      if (k.startsWith(prefix)) this.destroyKey(k)
    }
    for (const k of [...this.placements.keys()]) {
      if (k.startsWith(prefix)) this.placements.delete(k)
    }
  }

  async closeAll(): Promise<void> {
    for (const k of [...this.pages.keys(), ...this.creating.keys()]) this.destroyKey(k)
    this.placements.clear()
    this.cdp?.close()
    this.cdp = undefined
    const kill = this.killChrome
    this.killChrome = undefined
    if (kill !== undefined) await kill()
  }

  private assertDarwin(): void {
    if (this.platform !== 'darwin') throw new Error(BROWSER_DARWIN_REQUIRED)
  }

  private emit(root: string, id: string, state: BrowserState): void {
    const event: BrowserStateEvent = { root, id, state }
    for (const listener of this.listeners) listener(event)
  }

  private async ensureChrome(): Promise<Cdp> {
    if (this.cdp !== undefined) return this.cdp
    if (this.launching !== undefined) return this.launching
    this.launching = this.launch({ platform: this.platform, env: this.env }).then((launched) => {
      this.cdp = launched.cdp
      this.killChrome = launched.kill
      return launched.cdp
    })
    try {
      return await this.launching
    } finally {
      this.launching = undefined
    }
  }

  private async ensure(root: string, id: string): Promise<HostBrowserSession> {
    const k = key(root, id)
    const existing = this.pages.get(k)
    if (existing !== undefined && !existing.isDestroyed) return existing

    const inflight = this.creating.get(k)
    if (inflight !== undefined) return inflight

    const promise = this.create(root, id)
    this.creating.set(k, promise)
    try {
      const page = await promise
      this.pages.set(k, page)
      return page
    } finally {
      this.creating.delete(k)
    }
  }

  private async create(root: string, id: string): Promise<HostBrowserSession> {
    const cdp = await this.ensureChrome()
    const session = new HostBrowserSession(cdp, (state) => this.emit(root, id, state))
    await session.start()
    const bounds = this.placements.get(key(root, id))
    if (bounds !== undefined) await session.place(bounds)
    if (this.occluded) await session.setOccluded(true)
    return session
  }

  private destroyKey(k: string): void {
    this.placements.delete(k)
    this.creating.delete(k)
    const page = this.pages.get(k)
    if (page !== undefined) {
      this.pages.delete(k)
      page.destroy()
    }
  }
}
