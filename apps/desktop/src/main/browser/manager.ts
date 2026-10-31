import { createHash } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { BrowserCall } from '@exe/protocol'
import type { OperatorDialog } from './cdp-driver'
import type { EmulationState } from './emulation'
import type { Rule } from './rewrite'
import { CRASH_RELOAD_TIMEOUT_MS, crashReloadUrl } from './recovery'
import { BrowserPage, type Bounds, type BrowserState } from './page'

export type { BrowserState } from './page'
export type DialogInfo = OperatorDialog

export type OperatorOp = 'back' | 'forward' | 'reload' | 'stop' | { navigate: string }

const key = (root: string, id: string): string => `${root}\0${id}`

/** An address-bar navigation may only reach the web; the page's own links are the page's business. */
function operatorUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && raw !== 'about:blank') {
    throw new Error('Only http and https addresses can be opened')
  }
  return url.href
}

/**
 * Owns every embedded browser, one per (engagement, browser id). The engine's
 * calls create pages on demand, so an agent can drive a browser no pane shows;
 * the renderer only reports where a pane sits.
 */
export class BrowserManager {
  private readonly pages = new Map<string, BrowserPage>()
  /** Pages being created, so two calls racing for one browser share one page. */
  private readonly creating = new Map<string, { promise: Promise<BrowserPage>; flag: { cancelled: boolean } }>()
  /** Last placement per browser, kept even before its page exists. */
  private readonly placements = new Map<string, Bounds | null>()
  /** Emulation per browser, so a page rebuilt after a crash starts with it again. */
  private readonly emulations = new Map<string, EmulationState>()
  /** Rewrite rules per browser, kept for the same reason. */
  private readonly rules = new Map<string, Rule[]>()
  private occluded = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly push: (root: string, id: string, state: BrowserState) => void,
    private readonly askOperator: (root: string, id: string, d: DialogInfo) => Promise<{ accept: boolean; promptText?: string }>,
  ) {}

  async run(root: string, call: BrowserCall): Promise<unknown> {
    if (call.action === 'close') {
      this.destroy(root, call.browserId)
      return { closed: true }
    }
    const page = await this.ensure(root, call.browserId, call)
    return page.driver.run(call.action, call.args)
  }

  place(root: string, id: string, bounds: Bounds | null): void {
    this.placements.set(key(root, id), bounds)
    this.pages.get(key(root, id))?.place(bounds)
  }

  setOccluded(occluded: boolean): void {
    this.occluded = occluded
    for (const page of this.pages.values()) page.setOccluded(occluded)
  }

  /**
   * Address bar actions. Driven on the view directly rather than through the
   * driver, which treats every call as the agent's and would open its dialog window.
   */
  async operator(root: string, id: string, op: OperatorOp): Promise<void> {
    const page = await this.ensure(root, id, typeof op === 'object' ? { action: 'navigate', args: {} } : { action: 'snapshot', args: {} })
    if (page.isDestroyed) return
    if (typeof op === 'object') {
      await this.load(page, root, id, operatorUrl(op.navigate))
    } else if (op === 'back') page.back()
    else if (op === 'forward') page.forward()
    else if (op === 'stop') page.stop()
    else page.reload()
  }

  closeRoot(root: string): void {
    const prefix = `${root}\0`
    for (const k of [...this.pages.keys(), ...this.creating.keys()]) {
      if (k.startsWith(prefix)) this.destroyKey(k)
    }
    for (const k of [...this.placements.keys()]) {
      if (k.startsWith(prefix)) this.placements.delete(k)
    }
    for (const k of [...this.emulations.keys(), ...this.rules.keys()]) {
      if (k.startsWith(prefix)) {
        this.emulations.delete(k)
        this.rules.delete(k)
      }
    }
  }

  /** Destroys every browser and cancels the ones still being created; used when the window goes. */
  closeAll(): void {
    for (const k of [...this.pages.keys(), ...this.creating.keys()]) this.destroyKey(k)
    this.placements.clear()
    this.emulations.clear()
    this.rules.clear()
  }

  private async load(page: BrowserPage, root: string, id: string, url: string): Promise<void> {
    try {
      await page.load(url)
    } catch {
      // A failed or superseded load shows as the page's own error state; nothing to report to the address bar.
    }
    this.push(root, id, page.state())
  }

  /** `call` is what runs next, which decides whether a crashed page reloads its old address first. */
  private async ensure(root: string, id: string, call: Pick<BrowserCall, 'action' | 'args'>): Promise<BrowserPage> {
    const k = key(root, id)
    const existing = this.pages.get(k)
    if (existing !== undefined && !existing.crashed) return existing
    if (existing !== undefined) {
      // A crashed renderer loses the driver's CDP domains: start over on the same address,
      // unless the call navigates anyway. The reload is bounded so the call cannot outlast the agent's wait.
      const url = crashReloadUrl(existing.url, call)
      this.destroyKey(k, true)
      const page = await this.create(root, id)
      if (url !== undefined) await withTimeout(page.load(url).catch(() => undefined), CRASH_RELOAD_TIMEOUT_MS)
      return page
    }
    return this.create(root, id)
  }

  private create(root: string, id: string): Promise<BrowserPage> {
    const k = key(root, id)
    const pending = this.creating.get(k)
    if (pending !== undefined && !pending.flag.cancelled) return pending.promise
    const flag = { cancelled: false }
    const promise = this.build(root, id, () => flag.cancelled).finally(() => {
      if (this.creating.get(k)?.promise === promise) this.creating.delete(k)
    })
    this.creating.set(k, { promise, flag })
    return promise
  }

  private async build(root: string, id: string, cancelled: () => boolean): Promise<BrowserPage> {
    const partition = `persist:eng-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`
    const page: BrowserPage = new BrowserPage(
      this.win,
      partition,
      (state) => this.push(root, id, state),
      (d) => this.askOperator(root, id, d),
      {
        initial: this.emulations.get(key(root, id)) ?? {},
        changed: (state) => {
          // A page closed (or cancelled mid-build) while an emulate was in flight must not bring its entry back.
          if (!page.isDestroyed && !cancelled()) this.emulations.set(key(root, id), state)
        },
      },
      {
        initial: this.rules.get(key(root, id)) ?? [],
        changed: (rules) => {
          if (page.isDestroyed || cancelled()) return
          if (rules.length === 0) this.rules.delete(key(root, id))
          else this.rules.set(key(root, id), rules)
        },
      },
    )
    try {
      page.place(this.placements.get(key(root, id)) ?? null)
      page.setOccluded(this.occluded)
      await page.start()
      if (cancelled()) throw new Error('The browser was closed.')
    } catch (err) {
      page.destroy()
      throw err
    }
    this.pages.set(key(root, id), page)
    return page
  }

  private destroy(root: string, id: string): void {
    this.destroyKey(key(root, id))
  }

  private destroyKey(k: string, keepPlacement = false): void {
    const pending = this.creating.get(k)
    if (pending !== undefined) {
      pending.flag.cancelled = true
      this.creating.delete(k)
    }
    const page = this.pages.get(k)
    this.pages.delete(k)
    if (!keepPlacement) {
      this.placements.delete(k)
      this.emulations.delete(k)
      this.rules.delete(k)
    }
    page?.destroy()
  }
}

/** Waits for `promise`, but no longer than `ms`. */
function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.then(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
