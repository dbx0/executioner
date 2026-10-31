import { STALE_REF, type BrowserAction, type DialogChoice } from '@exe/protocol'
import { DialogPolicy } from './dialog-policy'
import { PageLog, type LogEntry } from './page-log'
import { renderSnapshot, type AXNode, type Snapshot } from './snapshot'

/** CDP payloads are untyped JSON; `JSON.parse` returns the loose type without a lint-banned `any`. */
export type Dyn = ReturnType<typeof JSON.parse>

export interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<Dyn>
  on(event: string, cb: (params: Dyn) => void): () => void
}

export interface OperatorDialog {
  type: string
  message: string
  defaultPrompt: string
  url: string
}

export interface CdpDriverOptions {
  now?: () => number
  askOperator: (d: OperatorDialog) => Promise<{ accept: boolean; promptText?: string }>
  operatorTimeoutMs?: number | undefined
}

const NAV_TIMEOUT_MS = 30_000
const WAIT_DEFAULT_MS = 10_000
const WAIT_POLL_MS = 100

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
}

function keyInfo(key: string): { code: string; vk: number; text?: string } {
  const known = KEYS[key]
  if (known) return known
  if (key.length !== 1) throw new Error(`Unsupported key: ${key}`)
  const upper = key.toUpperCase()
  const code = /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(key) ? `Digit${key}` : key === ' ' ? 'Space' : ''
  return { code, vk: upper.charCodeAt(0), text: key }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Drives one page over the Chrome DevTools Protocol. Pure of Electron: it only
 * needs something that can `send` commands and subscribe to events.
 */
export class CdpDriver {
  readonly log = new PageLog()
  private readonly policy: DialogPolicy
  private readonly operatorTimeoutMs: number
  private generation = 1
  private refs = new Map<string, number>()
  private refCounter = 0
  private url = ''

  constructor(
    private readonly cdp: Cdp,
    private readonly opts: CdpDriverOptions,
  ) {
    this.policy = new DialogPolicy(opts.now ?? Date.now)
    this.operatorTimeoutMs = opts.operatorTimeoutMs ?? 30_000
  }

  async start(): Promise<void> {
    this.cdp.on('Page.frameNavigated', (p) => {
      if (p.frame?.parentId) return
      this.generation++
      this.refs = new Map()
      this.refCounter = 0
      if (typeof p.frame?.url === 'string') this.url = p.frame.url
    })
    this.cdp.on('Runtime.consoleAPICalled', (p) => {
      const text = (p.args ?? []).map((a: Dyn) => (a.value !== undefined ? String(a.value) : (a.description ?? ''))).join(' ')
      this.log.push({ kind: 'console', level: p.type, text, url: this.url })
    })
    this.cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails ?? {}
      this.log.push({ kind: 'error', text: d.exception?.description ?? d.text ?? 'Uncaught exception', url: d.url ?? this.url })
    })
    this.cdp.on('Page.javascriptDialogOpening', (p) => void this.onDialog(p))
    for (const domain of ['Page', 'Runtime', 'DOM', 'Accessibility', 'Log']) await this.cdp.send(`${domain}.enable`)
  }

  async run(action: BrowserAction, args: Record<string, unknown>): Promise<unknown> {
    const end = this.policy.begin({
      dialog: args.dialog as DialogChoice | undefined,
      promptText: args.promptText as string | undefined,
    })
    try {
      return await this.dispatch(action, args)
    } finally {
      end()
    }
  }

  private async dispatch(action: BrowserAction, args: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'ensure':
        if (typeof args.url === 'string' && args.url !== '') await this.navigateTo(args.url)
        return this.pageInfo()
      case 'navigate':
        await this.navigateTo(args.url)
        return this.pageInfo()
      case 'back':
      case 'forward':
        await this.cdp.send('Runtime.evaluate', { expression: `history.${action}()` })
        return this.pageInfo()
      case 'reload': {
        const load = this.nextLoad(NAV_TIMEOUT_MS)
        try {
          await this.cdp.send('Page.reload')
        } catch (err) {
          load.cancel()
          throw err
        }
        await load.promise
        return this.pageInfo()
      }
      case 'snapshot': {
        const tree = await this.cdp.send('Accessibility.getFullAXTree')
        const snap: Snapshot = renderSnapshot((tree.nodes ?? []) as AXNode[], this.generation, this.refCounter)
        // Refs accumulate within a generation so an issued ref never points at a different node later.
        for (const [ref, id] of snap.refs) this.refs.set(ref, id)
        this.refCounter = snap.last
        return { snapshot: snap.text, ...(await this.pageInfo()) }
      }
      case 'click': {
        const backendNodeId = this.resolveRef(args.ref)
        let box: Dyn
        try {
          await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
          box = await this.cdp.send('DOM.getBoxModel', { backendNodeId })
        } catch {
          throw new Error(STALE_REF)
        }
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0]: number[] = box.model.content
        const x = (x1 + x2 + x3 + x4) / 4
        const y = (y1 + y2 + y3 + y4) / 4
        for (const type of ['mousePressed', 'mouseReleased']) {
          await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
        }
        return this.pageInfo()
      }
      case 'type': {
        const backendNodeId = this.resolveRef(args.ref)
        try {
          await this.cdp.send('DOM.focus', { backendNodeId })
          if (args.clear) {
            await this.callOn(
              backendNodeId,
              "function(){ this.value=''; this.dispatchEvent(new Event('input',{bubbles:true})) }",
            )
          }
        } catch {
          throw new Error(STALE_REF)
        }
        await this.cdp.send('Input.insertText', { text: String(args.text ?? '') })
        if (args.submit) await this.press('Enter')
        return this.pageInfo()
      }
      case 'select': {
        const backendNodeId = this.resolveRef(args.ref)
        const values = Array.isArray(args.values) ? args.values : [args.value]
        try {
          await this.callOn(
            backendNodeId,
            `function(values){ const set = new Set(values.map(String)); for (const o of this.options) o.selected = set.has(o.value) || set.has(o.text); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})) }`,
            [{ value: values }],
          )
        } catch {
          throw new Error(STALE_REF)
        }
        return this.pageInfo()
      }
      case 'press':
        await this.press(String(args.key ?? ''))
        return this.pageInfo()
      case 'eval': {
        const res = await this.cdp.send('Runtime.evaluate', {
          expression: args.expression,
          returnByValue: true,
          awaitPromise: true,
        })
        if (res.exceptionDetails) {
          const d = res.exceptionDetails
          throw new Error([d.text, d.exception?.description].filter(Boolean).join(': '))
        }
        return { value: res.result?.value }
      }
      case 'wait':
        return this.wait(args)
      case 'screenshot': {
        const res = await this.cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: args.fullPage === true,
        })
        return { data: res.data }
      }
      case 'log':
        return this.log.since(typeof args.since === 'number' ? args.since : undefined)
      default:
        throw new Error(`Unsupported browser action: ${action}`)
    }
  }

  private async pageInfo(): Promise<{ url: string; title: string }> {
    const res = await this.cdp.send('Runtime.evaluate', {
      expression: '[location.href, document.title]',
      returnByValue: true,
    })
    const value = res.result?.value
    const [url, title] = (Array.isArray(value) ? value : ['', '']) as [string, string]
    return { url, title }
  }

  /** Navigates and waits for load (capped); rejects at once if the navigation itself fails. */
  private async navigateTo(url: unknown): Promise<void> {
    const load = this.nextLoad(NAV_TIMEOUT_MS)
    let res: Dyn
    try {
      res = await this.cdp.send('Page.navigate', { url })
    } catch (err) {
      load.cancel()
      throw err
    }
    if (res?.errorText) {
      load.cancel()
      throw new Error(String(res.errorText))
    }
    await load.promise
  }

  /**
   * Waits for the next load event, or `ms` regardless. Each call owns its listener and timer;
   * `cancel` releases only this waiter's and resolves it false.
   */
  private nextLoad(ms: number): { promise: Promise<boolean>; cancel: () => void } {
    let finish: (loaded: boolean) => void = () => {}
    const promise = new Promise<boolean>((resolve) => {
      const off = this.cdp.on('Page.loadEventFired', () => finish(true))
      const timer = setTimeout(() => finish(false), ms)
      finish = (loaded) => {
        clearTimeout(timer)
        off()
        resolve(loaded)
      }
    })
    return { promise, cancel: () => finish(false) }
  }

  private async wait(args: Record<string, unknown>): Promise<unknown> {
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : WAIT_DEFAULT_MS
    const selector = typeof args.selector === 'string' ? args.selector : undefined
    if (!selector) {
      const matched = await this.nextLoad(timeoutMs).promise
      return { matched, ...(await this.pageInfo()) }
    }
    const deadline = Date.now() + timeoutMs
    const expression = `document.querySelector(${JSON.stringify(selector)}) !== null`
    for (;;) {
      const res = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true })
      if (res.result?.value === true) return { matched: true, ...(await this.pageInfo()) }
      if (Date.now() >= deadline) return { matched: false, ...(await this.pageInfo()) }
      await sleep(Math.min(WAIT_POLL_MS, Math.max(0, deadline - Date.now())))
    }
  }

  private async press(key: string): Promise<void> {
    const { code, vk, text } = keyInfo(key)
    const base = { key, code, windowsVirtualKeyCode: vk }
    await this.cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** Maps a ref to its node, or throws STALE_REF when the page has moved on since the snapshot. */
  private resolveRef(ref: unknown): number {
    const m = typeof ref === 'string' ? /^g(\d+)e\d+$/.exec(ref) : null
    const id = m && Number(m[1]) === this.generation ? this.refs.get(ref as string) : undefined
    if (id === undefined) throw new Error(STALE_REF)
    return id
  }

  private async callOn(backendNodeId: number, functionDeclaration: string, argv?: unknown[]): Promise<void> {
    const node = await this.cdp.send('DOM.resolveNode', { backendNodeId })
    await this.cdp.send('Runtime.callFunctionOn', {
      objectId: node.object.objectId,
      functionDeclaration,
      ...(argv ? { arguments: argv } : {}),
    })
  }

  private async onDialog(p: Dyn): Promise<void> {
    const entry: LogEntry = this.log.push({
      kind: 'dialog',
      text: p.message ?? '',
      url: p.url ?? this.url,
      dialogType: p.type,
    })
    const decision = this.policy.decide()
    if (decision.by === 'agent') {
      entry.handledBy = 'agent'
      await this.answer(decision.accept, decision.promptText)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), this.operatorTimeoutMs)
    })
    const asked = this.opts
      .askOperator({ type: p.type, message: p.message ?? '', defaultPrompt: p.defaultPrompt ?? '', url: p.url ?? this.url })
      .catch(() => ({ accept: false }) as { accept: boolean; promptText?: string })
    const result = await Promise.race([asked, timeout])
    clearTimeout(timer)
    if (result === 'timeout') {
      entry.handledBy = 'timeout'
      await this.answer(false)
    } else {
      entry.handledBy = 'operator'
      await this.answer(result.accept, result.promptText)
    }
  }

  private async answer(accept: boolean, promptText?: string): Promise<void> {
    try {
      await this.cdp.send('Page.handleJavaScriptDialog', { accept, promptText })
    } catch {
      // The dialog may already be gone (page navigated or closed); nothing left to answer.
    }
  }
}
