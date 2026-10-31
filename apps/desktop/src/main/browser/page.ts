import { WebContentsView, type BrowserWindow, type Session } from 'electron'
import { CdpDriver, type Cdp, type Dyn, type OperatorDialog } from './cdp-driver'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  crashed: boolean
}

const DEFAULT_SIZE = { width: 1280, height: 800 }
/** Where a view parks when no pane shows it: off screen, but still visible so screenshots and input work. */
const PARKED_X = -20000

/** Partitions whose permission handler is already set; it is per session, so once is enough. */
const guarded = new Set<string>()

function guardSession(partition: string, ses: Session): void {
  if (guarded.has(partition)) return
  guarded.add(partition)
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })
  ses.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write')
}

/**
 * One embedded browser: a native view with its own page, driven over CDP. It
 * holds only Electron plumbing; every decision lives in the driver.
 */
export class BrowserPage {
  readonly driver: CdpDriver
  private readonly view: WebContentsView
  private bounds: Bounds | null = null
  private size: { width: number; height: number } = DEFAULT_SIZE
  private occluded = false
  private crashedFlag = false
  private destroyed = false

  constructor(
    private readonly win: BrowserWindow,
    partition: string,
    private readonly push: (state: BrowserState) => void,
    askOperator: (d: OperatorDialog) => Promise<{ accept: boolean; promptText?: string }>,
  ) {
    this.view = new WebContentsView({
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    const wc = this.view.webContents
    guardSession(partition, wc.session)
    try {
      wc.debugger.attach('1.3')
    } catch (err) {
      wc.close()
      throw err
    }
    wc.setBackgroundThrottling(false)
    // Popups open in the same view instead of a second window.
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    const cdp: Cdp = {
      send: (method, params) => wc.debugger.sendCommand(method, params) as Promise<Dyn>,
      on: (event, cb) => {
        const listener = (_e: unknown, method: string, params: Dyn): void => {
          if (method === event) cb(params)
        }
        wc.debugger.on('message', listener)
        return () => {
          wc.debugger.removeListener('message', listener)
        }
      },
    }
    this.driver = new CdpDriver(cdp, { askOperator })

    const emit = (): void => this.emit()
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    wc.on('page-title-updated', emit)
    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    // A detached debugger loses the driver's CDP domains, same as a crash: rebuild on the next call.
    wc.debugger.on('detach', () => {
      if (this.destroyed) return
      this.crashedFlag = true
      this.emit()
    })
    wc.on('render-process-gone', () => {
      this.crashedFlag = true
      this.emit()
    })
    // Last, so nothing above can throw with the view already on screen.
    win.contentView.addChildView(this.view)
    this.applyBounds()
  }

  /** Starts the driver. Separate from the constructor because it is async. */
  async start(): Promise<void> {
    // Commit a blank document first so the CDP enable calls run against a real page.
    const wc = this.view.webContents
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        wc.loadURL('about:blank').catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    if (this.destroyed) return
    await this.driver.start()
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  get crashed(): boolean {
    return this.crashedFlag
  }

  get url(): string {
    return this.destroyed ? '' : this.view.webContents.getURL()
  }

  state(): BrowserState {
    const wc = this.view.webContents
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      crashed: this.crashedFlag,
    }
  }

  /** Where the pane is, or null when none shows this page. */
  place(bounds: Bounds | null): void {
    // Electron wants whole pixels; the renderer's rects are fractional.
    this.bounds =
      bounds === null
        ? null
        : {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.max(0, Math.round(bounds.width)),
            height: Math.max(0, Math.round(bounds.height)),
          }
    if (this.bounds !== null && this.bounds.width > 0 && this.bounds.height > 0) {
      this.size = { width: this.bounds.width, height: this.bounds.height }
    }
    this.applyBounds()
  }

  setOccluded(occluded: boolean): void {
    this.occluded = occluded
    this.applyBounds()
  }

  async load(url: string): Promise<void> {
    await this.view.webContents.loadURL(url)
  }

  back(): void {
    this.view.webContents.navigationHistory.goBack()
  }

  forward(): void {
    this.view.webContents.navigationHistory.goForward()
  }

  stop(): void {
    this.view.webContents.stop()
  }

  reload(): void {
    this.crashedFlag = false
    this.view.webContents.reload()
    this.emit()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const wc = this.view.webContents
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach()
    } catch {
      // already detached by a crash
    }
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(this.view)
    if (!wc.isDestroyed()) wc.close()
  }

  private applyBounds(): void {
    if (this.destroyed) return
    this.view.setVisible(!this.occluded)
    this.view.setBounds(this.bounds ?? { x: PARKED_X, y: 0, ...this.size })
  }

  private emit(): void {
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    this.push(this.state())
  }
}
