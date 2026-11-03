import type { Cdp } from './cdp.js'
import type { Bounds, BrowserState, OperatorOp } from './types.js'
import { EMPTY_STATE } from './types.js'

export function operatorUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && raw !== 'about:blank') {
    throw new Error('Only http and https addresses can be opened')
  }
  return url.href
}

/**
 * One host-owned Chromium window (CDP target + OS window) for a browser pane id.
 */
export class HostBrowserSession {
  private state: BrowserState = { ...EMPTY_STATE }
  private targetId: string | undefined
  private sessionId: string | undefined
  private windowId: number | undefined
  private destroyed = false
  private readonly unsubs: Array<() => void> = []

  constructor(
    private readonly cdp: Cdp,
    private readonly push: (state: BrowserState) => void,
  ) {}

  async start(): Promise<void> {
    const created = (await this.cdp.send('Target.createTarget', {
      url: 'about:blank',
      newWindow: true,
    })) as { targetId?: string }
    if (typeof created.targetId !== 'string') throw new Error('Target.createTarget failed')
    this.targetId = created.targetId

    const attached = (await this.cdp.send('Target.attachToTarget', {
      targetId: this.targetId,
      flatten: true,
    })) as { sessionId?: string }
    if (typeof attached.sessionId !== 'string') throw new Error('Target.attachToTarget failed')
    this.sessionId = attached.sessionId

    await this.sessionSend('Page.enable')
    await this.sessionSend('Runtime.enable')

    this.unsubs.push(
      this.cdp.on('Page.frameNavigated', (params, sessionId) => {
        if (sessionId !== this.sessionId) return
        const frame = (params as { frame?: { url?: string; parentId?: string } }).frame
        if (frame === undefined || frame.parentId !== undefined) return
        if (typeof frame.url === 'string') this.patch({ url: frame.url, loading: true })
      }),
      this.cdp.on('Page.loadEventFired', (_params, sessionId) => {
        if (sessionId !== this.sessionId) return
        void this.refresh()
      }),
      this.cdp.on('Page.navigatedWithinDocument', (params, sessionId) => {
        if (sessionId !== this.sessionId) return
        const url = (params as { url?: string }).url
        if (typeof url === 'string') this.patch({ url })
      }),
    )

    try {
      const win = (await this.cdp.send('Browser.getWindowForTarget', {
        targetId: this.targetId,
      })) as { windowId?: number }
      this.windowId = win.windowId
    } catch {
      this.windowId = undefined
    }

    this.patch({ url: 'about:blank', loading: false })
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  current(): BrowserState {
    return this.state
  }

  async place(bounds: Bounds | null): Promise<void> {
    if (this.destroyed || this.windowId === undefined) return
    try {
      if (bounds === null) {
        await this.cdp.send('Browser.setWindowBounds', {
          windowId: this.windowId,
          bounds: { windowState: 'minimized' },
        })
        return
      }
      await this.cdp.send('Browser.setWindowBounds', {
        windowId: this.windowId,
        bounds: {
          windowState: 'normal',
          left: Math.round(bounds.x),
          top: Math.round(bounds.y),
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        },
      })
    } catch {}
  }

  async setOccluded(occluded: boolean): Promise<void> {
    if (this.destroyed || this.windowId === undefined) return
    try {
      await this.cdp.send('Browser.setWindowBounds', {
        windowId: this.windowId,
        bounds: { windowState: occluded ? 'minimized' : 'normal' },
      })
    } catch {}
  }

  async operator(op: OperatorOp): Promise<void> {
    if (this.destroyed || this.sessionId === undefined) return
    if (typeof op === 'object') {
      const url = operatorUrl(op.navigate)
      this.patch({ loading: true, url })
      await this.sessionSend('Page.navigate', { url })
      await this.refresh()
      return
    }
    if (op === 'reload') {
      this.patch({ loading: true })
      await this.sessionSend('Page.reload')
      await this.refresh()
      return
    }
    if (op === 'stop') {
      await this.sessionSend('Page.stopLoading')
      await this.refresh()
      return
    }
    await this.sessionSend('Runtime.evaluate', {
      expression: op === 'back' ? 'history.back()' : 'history.forward()',
    })
    await this.refresh()
  }

  markCrashed(): void {
    if (this.destroyed) return
    this.patch({ crashed: true, loading: false })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const u of this.unsubs) u()
    this.unsubs.length = 0
    if (this.targetId !== undefined) {
      void this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined)
    }
  }

  private async sessionSend(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.cdp.send(method, params, this.sessionId)
  }

  private async refresh(): Promise<void> {
    if (this.destroyed || this.sessionId === undefined) return
    try {
      const info = (await this.sessionSend('Runtime.evaluate', {
        expression:
          `(() => ({ url: location.href, title: document.title,` +
          ` canGoBack: history.length > 1, canGoForward: false }))()`,
        returnByValue: true,
      })) as { result?: { value?: Partial<BrowserState> } }
      const value = info.result?.value ?? {}
      this.patch({
        url: typeof value.url === 'string' ? value.url : this.state.url,
        title: typeof value.title === 'string' ? value.title : this.state.title,
        loading: false,
        canGoBack: value.canGoBack === true,
        canGoForward: value.canGoForward === true,
        crashed: false,
      })
    } catch {
      this.patch({ loading: false, crashed: true })
    }
  }

  private patch(partial: Partial<BrowserState>): void {
    this.state = { ...this.state, ...partial }
    if (!this.destroyed) this.push(this.state)
  }
}
