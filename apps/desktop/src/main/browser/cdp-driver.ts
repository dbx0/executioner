import { STALE_REF, type BrowserAction, type DialogChoice } from '@exe/protocol'
import { DialogPolicy } from './dialog-policy'
import { PageLog, type LogEntry } from './page-log'
import {
  cleanUserAgent,
  clientHintHeaders,
  effectiveUserAgentMetadata,
  emulationCommands,
  geolocationShim,
  isEmulating,
  mergeEmulation,
  sendsClientHints,
  withClientHints,
  type EmulationState,
} from './emulation'
import { FrameTracker } from './frames'
import { NetworkLog } from './network-log'
import { matchRule, mergeHeaders, type HeaderEntry, type Rule } from './rewrite'
import { renderFrames, type AXNode, type FrameSection, type RefTarget } from './snapshot'

/** CDP payloads are untyped JSON; `JSON.parse` returns the loose type without a lint-banned `any`. */
export type Dyn = ReturnType<typeof JSON.parse>

export interface Cdp {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Dyn>
  on(event: string, cb: (params: Dyn, sessionId?: string) => void): () => void
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
  /** Emulation to apply on start, so it outlives the driver a crashed page replaces. */
  emulation?: EmulationState | undefined
  /** Called with the new state whenever `emulate` changes it. */
  onEmulation?: ((state: EmulationState) => void) | undefined
  /** Rewrite rules to apply on start, so they too outlive the driver a crashed page replaces. */
  rules?: Rule[] | undefined
  /** Called with the new rules whenever `rewrite` replaces them. */
  onRules?: ((rules: Rule[]) => void) | undefined
  /** The user agent a cleared override goes back to; without it, the browser's own with app tokens removed. */
  defaultUserAgent?: string | undefined
}

const NAV_TIMEOUT_MS = 30_000
const WAIT_DEFAULT_MS = 10_000
const WAIT_POLL_MS = 100
/** Domains switched on inside each out-of-process iframe session, next to the page's own. */
const CHILD_DOMAINS = ['Runtime', 'DOM', 'Accessibility', 'Page', 'Network']
/** Fetch patterns for the documents that get client hints; sendsClientHints makes the exact call. */
const HINTED_DOCUMENTS = ['https://*', 'http://localhost*', 'http://*.localhost*', 'http://127.*', 'http://[::1]*']
/** browser_response_body hands back at most this many decoded bytes unless asked for more, and never more than the cap. */
const DEFAULT_BODY_BYTES = 20_000
const MAX_BODY_BYTES = 1_000_000

/** A frame an `f<n>` label points at: an iframe session, a same-process frame id, or both when nested. */
type FrameRef = Omit<RefTarget, 'backendNodeId'>

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

/** Whether a `Page.getFrameTree` node, or any frame below it, has this frame id. */
function containsFrame(node: Dyn, frameId: string): boolean {
  if (!node) return false
  if (node.frame?.id === frameId) return true
  return (node.childFrames ?? []).some((c: Dyn) => containsFrame(c, frameId))
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** A whole number from an untyped argument, or the fallback. */
function intArg(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
}

/**
 * One window of a response body, counted in decoded bytes: `maxBytes` (default 20 000, at most
 * 1 000 000) from `offset`. Text is cut on a UTF-8 character boundary; binary is re-encoded, so the
 * base64 always decodes. `nextOffset` is where the following window starts when there is more.
 */
export function bodyWindow(
  res: Dyn,
  offsetArg: unknown,
  maxArg: unknown,
): { body: string; base64Encoded: boolean; truncated: boolean; totalBytes: number; offset: number; nextOffset?: number } {
  const base64Encoded = res?.base64Encoded === true
  const raw = String(res?.body ?? '')
  const bytes = base64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8')
  const total = bytes.length
  const max = Math.min(MAX_BODY_BYTES, Math.max(1, intArg(maxArg, DEFAULT_BODY_BYTES)))
  const continuation = (i: number) => !base64Encoded && i < total && ((bytes[i] ?? 0) & 0xc0) === 0x80
  let start = Math.min(total, Math.max(0, intArg(offsetArg, 0)))
  while (continuation(start)) start++
  let end = Math.min(total, start + max)
  while (end > start && continuation(end)) end--
  // A window smaller than one character still moves forward by that character.
  if (end === start && start < total) {
    end = start + 1
    while (continuation(end)) end++
  }
  const slice = bytes.subarray(start, end)
  const truncated = end < total
  return {
    body: base64Encoded ? slice.toString('base64') : slice.toString('utf8'),
    base64Encoded,
    truncated,
    totalBytes: total,
    offset: start,
    ...(truncated ? { nextOffset: end } : {}),
  }
}

/**
 * Drives one page over the Chrome DevTools Protocol. Pure of Electron: it only
 * needs something that can `send` commands and subscribe to events.
 */
export class CdpDriver {
  readonly log = new PageLog()
  readonly network = new NetworkLog()
  private rules: Rule[] = []
  private ruleCounter = 0
  private readonly policy: DialogPolicy
  private readonly operatorTimeoutMs: number
  private generation = 1
  private readonly frameTracker = new FrameTracker()
  private readonly pendingSetup = new Set<Promise<void>>()
  private refs = new Map<string, RefTarget>()
  private refCounter = 0
  private frames = new Map<string, FrameRef>()
  private frameCounter = 0
  private url = ''
  private emulationState: EmulationState
  /** Every emulation apply runs through this chain, so each one reads the state current when it runs. */
  private emulationQueue: Promise<unknown> = Promise.resolve()
  private pressedButtons = 0
  /** The geolocation shim registered in each session ('' = root), with the position it carries. */
  private readonly geoScripts = new Map<string, { identifier: string; position: string }>()
  /** Main-world execution context per frame, keyed `${sessionId ?? ''}\0${frameId}`. */
  private readonly mainContexts = new Map<string, number>()
  private defaultUA: string | undefined

  constructor(
    private readonly cdp: Cdp,
    private readonly opts: CdpDriverOptions,
  ) {
    this.policy = new DialogPolicy(opts.now ?? Date.now)
    this.operatorTimeoutMs = opts.operatorTimeoutMs ?? 30_000
    this.emulationState = { ...opts.emulation }
    this.rules = [...(opts.rules ?? [])]
    // Carried rules keep their ids, so new ones are numbered past them.
    for (const r of this.rules) {
      const n = /^r(\d+)$/.exec(r.id ?? '')
      if (n !== null) this.ruleCounter = Math.max(this.ruleCounter, Number(n[1]))
    }
  }

  /** The emulation currently applied to the page. */
  emulation(): EmulationState {
    return { ...this.emulationState }
  }

  /** Subscribes to a CDP event; an empty session id (how Electron reports the root session) means undefined. */
  private subscribe(event: string, cb: (params: Dyn, sessionId?: string) => void): () => void {
    return this.cdp.on(event, (params, sessionId) => cb(params, sessionId || undefined))
  }

  async start(): Promise<void> {
    this.subscribe('Page.frameNavigated', (p, sessionId) => {
      if (sessionId !== undefined) {
        // An iframe session navigating only moves its own url; the page's refs stay valid.
        const child = this.frameTracker.get(sessionId)
        if (child && p.frame?.id === child.targetId && typeof p.frame?.url === 'string') {
          this.frameTracker.setUrl(sessionId, p.frame.url)
        }
        return
      }
      if (p.frame?.parentId) return
      this.generation++
      this.refs = new Map()
      this.refCounter = 0
      this.frames = new Map()
      this.frameCounter = 0
      if (typeof p.frame?.url === 'string') this.url = p.frame.url
    })
    this.subscribe('Target.attachedToTarget', (p, parentSessionId) => {
      const child = this.frameTracker.attach(p.sessionId, p.targetInfo, parentSessionId)
      if (!child) return
      const setup = this.setupChild(child.sessionId).finally(() => this.pendingSetup.delete(setup))
      this.pendingSetup.add(setup)
    })
    this.subscribe('Target.detachedFromTarget', (p) => {
      for (const gone of this.frameTracker.detach(p.sessionId)) {
        this.geoScripts.delete(gone)
        this.forgetContexts(gone)
      }
    })
    this.subscribe('Runtime.executionContextCreated', (p, sessionId) => {
      const ctx = p?.context
      if (ctx?.auxData?.isDefault === true && typeof ctx.auxData.frameId === 'string' && typeof ctx.id === 'number') {
        this.mainContexts.set(`${sessionId ?? ''}\0${ctx.auxData.frameId}`, ctx.id)
      }
    })
    this.subscribe('Runtime.executionContextDestroyed', (p, sessionId) => {
      const prefix = `${sessionId ?? ''}\0`
      for (const [k, id] of this.mainContexts) if (k.startsWith(prefix) && id === p?.executionContextId) this.mainContexts.delete(k)
    })
    this.subscribe('Runtime.executionContextsCleared', (_p, sessionId) => this.forgetContexts(sessionId ?? ''))
    this.subscribe('Runtime.consoleAPICalled', (p, sessionId) => {
      const text = (p.args ?? []).map((a: Dyn) => (a.value !== undefined ? String(a.value) : (a.description ?? ''))).join(' ')
      this.log.push({ kind: 'console', level: p.type, text, url: this.frameTracker.urlOf(sessionId, this.url) })
    })
    this.subscribe('Runtime.exceptionThrown', (p, sessionId) => {
      const d = p.exceptionDetails ?? {}
      this.log.push({
        kind: 'error',
        text: d.exception?.description ?? d.text ?? 'Uncaught exception',
        url: d.url ?? this.frameTracker.urlOf(sessionId, this.url),
      })
    })
    this.subscribe('Network.requestWillBeSent', (p, sessionId) => this.network.requestWillBeSent(p, sessionId))
    // The headers that really went out and came back, after rewrites and with what the network stack adds.
    this.subscribe('Network.requestWillBeSentExtraInfo', (p) => this.network.requestWillBeSentExtraInfo(p))
    this.subscribe('Network.responseReceivedExtraInfo', (p) => this.network.responseReceivedExtraInfo(p))
    this.subscribe('Network.responseReceived', (p) => this.network.responseReceived(p))
    this.subscribe('Network.loadingFinished', (p) => this.network.loadingFinished(p))
    this.subscribe('Network.loadingFailed', (p) => this.network.loadingFailed(p))
    this.subscribe('Fetch.requestPaused', (p, sessionId) => void this.onPaused(p, sessionId))
    this.subscribe('Page.javascriptDialogOpening', (p, sessionId) => void this.onDialog(p, sessionId))
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    for (const domain of ['Page', 'Runtime', 'DOM', 'Accessibility', 'Network', 'Log']) await this.cdp.send(`${domain}.enable`)
    try {
      await this.cdp.send('Fetch.enable', { patterns: this.patterns() })
    } catch (err) {
      this.log.push({ kind: 'error', text: `Navigations will lack client hints: ${err instanceof Error ? err.message : String(err)}`, url: this.url })
    }
    // Always applied, even with nothing emulated: it puts the clean default user agent and its client hints in place.
    await this.queueEmulation(async () => {
      const restoring = isEmulating(this.emulationState)
      try {
        await this.applyEmulation(this.emulationState, [undefined])
        if (restoring) this.opts.onEmulation?.(this.emulation())
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        if (!restoring) {
          this.log.push({ kind: 'error', text: `The default user agent was not applied: ${reason}`, url: this.url })
          return
        }
        this.log.push({ kind: 'error', text: `Emulation was not restored: ${reason}`, url: this.url })
        // The page is not in the claimed state, so report what is true: nothing is emulated.
        this.emulationState = {}
        await this.applyEmulation({}, [undefined]).catch(() => undefined)
        this.opts.onEmulation?.({})
      }
    })
  }

  private forgetContexts(sessionKey: string): void {
    const prefix = `${sessionKey}\0`
    for (const k of [...this.mainContexts.keys()]) if (k.startsWith(prefix)) this.mainContexts.delete(k)
  }

  private queueEmulation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.emulationQueue.then(task)
    this.emulationQueue = run.catch(() => undefined)
    return run
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
    // Iframe sessions attached a moment ago must have their domains on before an action looks inside them.
    await Promise.all([...this.pendingSetup])
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
        const snap = renderFrames(await this.collectSections(), this.generation, this.refCounter)
        // Refs accumulate within a generation so an issued ref never points at a different node later.
        for (const [ref, id] of snap.refs) this.refs.set(ref, id)
        this.refCounter = snap.last
        return { snapshot: snap.text, ...(await this.pageInfo()) }
      }
      case 'click': {
        const { x, y } = await this.refCentre(args.ref)
        for (const type of ['mousePressed', 'mouseReleased']) {
          await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
        }
        return this.pageInfo()
      }
      case 'type': {
        const { backendNodeId, sessionId } = await this.resolveRef(args.ref)
        try {
          await this.cdp.send('DOM.focus', { backendNodeId }, sessionId)
          if (args.clear) {
            await this.callOn(
              backendNodeId,
              "function(){ this.value=''; this.dispatchEvent(new Event('input',{bubbles:true})) }",
              undefined,
              sessionId,
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
        const { backendNodeId, sessionId } = await this.resolveRef(args.ref)
        const values = Array.isArray(args.values) ? args.values : [args.value]
        try {
          await this.callOn(
            backendNodeId,
            `function(values){ const set = new Set(values.map(String)); for (const o of this.options) o.selected = set.has(o.value) || set.has(o.text); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})) }`,
            [{ value: values }],
            sessionId,
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
        const evaluate = (where: { sessionId?: string; contextId?: number }) =>
          this.cdp.send(
            'Runtime.evaluate',
            {
              expression: args.expression,
              returnByValue: true,
              awaitPromise: true,
              ...(where.contextId !== undefined ? { contextId: where.contextId } : {}),
            },
            where.sessionId,
          )
        const where = await this.evalTarget(args.frame)
        let res: Dyn
        try {
          res = await evaluate(where)
        } catch (err) {
          // A main-world context can go between its event and this call; an isolated world in the frame still works.
          if (where.fallback === undefined) throw err
          res = await evaluate(await where.fallback())
        }
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
      case 'network': {
        const filter: { urlContains?: string; limit?: number } = {}
        if (typeof args.urlContains === 'string') filter.urlContains = args.urlContains
        if (typeof args.limit === 'number') filter.limit = args.limit
        return {
          ...this.network.since(typeof args.since === 'number' ? args.since : undefined, filter),
          ...(await this.pageInfo()),
        }
      }
      case 'response_body': {
        const entry = typeof args.requestId === 'string' ? this.network.find(args.requestId) : undefined
        if (!entry) throw new Error('Unknown request id; list requests with browser_network first.')
        const res = await this.cdp.send('Network.getResponseBody', { requestId: entry.requestId }, entry.sessionId)
        return { ...bodyWindow(res, args.offset, args.maxBytes), ...(await this.pageInfo()) }
      }
      case 'rewrite':
        return { rules: await this.setRules(args.rules), ...(await this.pageInfo()) }
      case 'upload': {
        const { backendNodeId, sessionId } = await this.resolveRef(args.ref)
        const files = Array.isArray(args.paths) ? args.paths.map(String) : []
        await this.cdp.send('DOM.setFileInputFiles', { files, backendNodeId }, sessionId)
        await this.callOn(
          backendNodeId,
          "function(){ this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})) }",
          undefined,
          sessionId,
        )
        return this.pageInfo()
      }
      case 'mouse':
        await this.mouse(args)
        return this.pageInfo()
      case 'drag':
        await this.drag(args.from, args.to, typeof args.steps === 'number' ? args.steps : 10)
        return this.pageInfo()
      case 'emulate': {
        await this.queueEmulation(async () => {
          const next = mergeEmulation(this.emulationState, {
            userAgent: args.userAgent as string | null | undefined,
            geolocation: args.geolocation as EmulationState['geolocation'] | null | undefined,
            locale: args.locale as string | null | undefined,
            timezone: args.timezone as string | null | undefined,
            userAgentMetadata: args.userAgentMetadata as EmulationState['userAgentMetadata'] | null | undefined,
          })
          const sessions = [undefined, ...this.frameTracker.list().map((c) => c.sessionId)]
          try {
            await this.applyEmulation(next, sessions)
          } catch (err) {
            // Put the page back to what it was, so the reported state stays true.
            await this.applyEmulation(this.emulationState, sessions).catch(() => undefined)
            throw new Error(`Emulation was rejected: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
          }
          this.emulationState = next
          this.opts.onEmulation?.(this.emulation())
        })
        return { emulation: this.emulation(), ...(await this.pageInfo()) }
      }
      default:
        throw new Error(`Unsupported browser action: ${action}`)
    }
  }

  /**
   * Maps a ref or a point to page coordinates: the centre of the node's box, offset by every frame
   * owner box above it, so an element in an iframe lands where the page draws it.
   */
  private async refCentre(target: unknown): Promise<{ x: number; y: number }> {
    if (typeof target === 'object' && target !== null) {
      const { x, y } = target as { x?: unknown; y?: unknown }
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('A point needs numeric x and y.')
      return { x, y }
    }
    const { backendNodeId, sessionId } = await this.resolveRef(target)
    let box: Dyn
    let offset: { x: number; y: number }
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, sessionId)
      // Scroll every frame owner into view too, then read all boxes so no scroll moves one after it is read.
      const owners = sessionId !== undefined ? await this.scrollOwners(sessionId) : []
      box = await this.cdp.send('DOM.getBoxModel', { backendNodeId }, sessionId)
      offset = await this.ownerOffset(owners)
    } catch {
      throw new Error(STALE_REF)
    }
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0]: number[] = box.model.content
    return { x: (x1 + x2 + x3 + x4) / 4 + offset.x, y: (y1 + y2 + y3 + y4) / 4 + offset.y }
  }

  private async mouse(args: Record<string, unknown>): Promise<void> {
    const x = Number(args.x)
    const y = Number(args.y)
    const name = typeof args.button === 'string' ? args.button : 'left'
    const button = name === 'right' || name === 'middle' ? name : 'left'
    const buttons = { left: 1, right: 2, middle: 4 }[button]
    const send = (params: Record<string, unknown>) => this.cdp.send('Input.dispatchMouseEvent', { x, y, ...params })
    // The reported button follows the bits still held, lowest first.
    const held = this.pressedButtons
    const heldButton = held & 1 ? 'left' : held & 2 ? 'right' : held & 4 ? 'middle' : undefined
    const move = () => send({ type: 'mouseMoved', ...(heldButton !== undefined ? { button: heldButton, buttons: held } : {}) })
    const press = (clickCount: number) =>
      send({ type: 'mousePressed', button, buttons: held | buttons, clickCount }).then(() =>
        send({ type: 'mouseReleased', button, buttons: held, clickCount }),
      )
    switch (args.action) {
      case 'move':
        await move()
        return
      case 'click':
        await move()
        await press(1)
        return
      case 'double':
        await move()
        await press(1)
        await press(2)
        return
      case 'down':
        await send({ type: 'mousePressed', button, buttons: this.pressedButtons | buttons, clickCount: 1 })
        this.pressedButtons |= buttons
        return
      case 'up':
        this.pressedButtons &= ~buttons
        await send({ type: 'mouseReleased', button, buttons: this.pressedButtons, clickCount: 1 })
        return
      case 'wheel':
        await send({ type: 'mouseWheel', deltaX: Number(args.deltaX ?? 0), deltaY: Number(args.deltaY ?? 0) })
        return
      default:
        throw new Error(`Unsupported mouse action: ${String(args.action)}`)
    }
  }

  /** Presses at `from`, moves to `to` in steps and releases; drags the page hands to the browser are dropped at `to`. */
  private async drag(fromArg: unknown, toArg: unknown, steps: number): Promise<void> {
    const from = await this.refCentre(fromArg)
    const to = await this.refCentre(toArg)
    const count = Math.max(1, Math.floor(steps))
    let intercepted: Dyn
    const off = this.subscribe('Input.dragIntercepted', (p, sessionId) => {
      if (sessionId === undefined) intercepted = p?.data
    })
    const mouse = (params: Record<string, unknown>) => this.cdp.send('Input.dispatchMouseEvent', params)
    try {
      await this.cdp.send('Input.setInterceptDrags', { enabled: true })
      await mouse({ type: 'mouseMoved', x: from.x, y: from.y })
      await mouse({ type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
      for (let i = 1; i <= count; i++) {
        const x = from.x + ((to.x - from.x) * i) / count
        const y = from.y + ((to.y - from.y) * i) / count
        await mouse({ type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
      }
      if (intercepted !== undefined) {
        for (const type of ['dragEnter', 'dragOver', 'drop']) {
          await this.cdp.send('Input.dispatchDragEvent', { type, x: to.x, y: to.y, data: intercepted })
        }
      }
      await mouse({ type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 })
    } finally {
      off()
      await this.cdp.send('Input.setInterceptDrags', { enabled: false }).catch(() => undefined)
    }
  }

  /**
   * Sends the state's commands to each session. The first session is the one that matters: its error
   * propagates, while an iframe session that has gone is skipped.
   */
  private async applyEmulation(state: EmulationState, sessions: (string | undefined)[]): Promise<void> {
    const defaultUserAgent = state.userAgent === undefined ? await this.defaultUserAgent() : ''
    for (const sessionId of sessions) {
      for (const [method, params] of emulationCommands(state, defaultUserAgent)) {
        try {
          await this.cdp.send(method, params, sessionId)
        } catch (err) {
          if (sessionId === undefined) throw err
          // An iframe session may be gone or refuse a page-wide command; the others still apply.
        }
      }
      await this.applyGeolocationShim(state, sessionId)
    }
  }

  /** The user agent with no override: the one the page was given, or the browser's own without app tokens. */
  private async defaultUserAgent(): Promise<string> {
    if (this.opts.defaultUserAgent !== undefined) return this.opts.defaultUserAgent
    if (this.defaultUA === undefined) {
      try {
        this.defaultUA = cleanUserAgent(String((await this.cdp.send('Browser.getVersion')).userAgent ?? ''))
      } catch {
        return ''
      }
    }
    return this.defaultUA
  }

  /**
   * Backs the CDP geolocation override with a script in every document of the session, since Electron
   * can still ask its own location provider (and fail) with the override set. A new position replaces
   * the script; clearing removes it and puts the browser's functions back in the documents already loaded.
   */
  private async applyGeolocationShim(state: EmulationState, sessionId: string | undefined): Promise<void> {
    const key = sessionId ?? ''
    const current = this.geoScripts.get(key)
    const geo = state.geolocation
    const position = geo === undefined ? null : { latitude: geo.latitude, longitude: geo.longitude, accuracy: geo.accuracy ?? 100 }
    const json = JSON.stringify(position)
    if (current === undefined ? position === null : current.position === json) return
    const source = geolocationShim(position)
    try {
      if (current !== undefined) {
        this.geoScripts.delete(key)
        await this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: current.identifier }, sessionId)
      }
      // runImmediately also runs it in every frame already loaded, same-process iframes included.
      const added = await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true }, sessionId)
      const identifier = typeof added?.identifier === 'string' ? added.identifier : undefined
      if (position !== null && identifier !== undefined) this.geoScripts.set(key, { identifier, position: json })
      // The restoring script only had to run once.
      if (position === null && identifier !== undefined) {
        await this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId)
      }
      await this.cdp.send('Runtime.evaluate', { expression: source }, sessionId)
    } catch (err) {
      if (sessionId !== undefined) return
      this.log.push({ kind: 'error', text: `The geolocation script was not applied: ${err instanceof Error ? err.message : String(err)}`, url: this.url })
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
      const off = this.subscribe('Page.loadEventFired', (_p, sessionId) => {
        if (sessionId === undefined) finish(true)
      })
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

  /**
   * Maps a ref to its node, or throws STALE_REF when the page has moved on since the snapshot
   * or the iframe holding the node has gone.
   */
  private async resolveRef(ref: unknown): Promise<RefTarget> {
    const m = typeof ref === 'string' ? /^g(\d+)e\d+$/.exec(ref) : null
    const target = m && Number(m[1]) === this.generation ? this.refs.get(ref as string) : undefined
    if (target === undefined || !(await this.isLive(target))) throw new Error(STALE_REF)
    return target
  }

  /** Whether the iframe session is still attached and the same-process frame is still in the frame tree. */
  private async isLive(where: FrameRef): Promise<boolean> {
    if (where.sessionId !== undefined && !this.frameTracker.has(where.sessionId)) return false
    if (where.frameId === undefined) return true
    try {
      const res = await this.cdp.send('Page.getFrameTree', undefined, where.sessionId)
      return containsFrame(res.frameTree, where.frameId)
    } catch {
      return false
    }
  }

  /**
   * Resolves the `frame` argument of eval to the session and execution context to run in. An
   * out-of-process iframe is its own session; a same-process frame runs in its main world, so the
   * frame's own globals are visible, or in an isolated world when that context is not known.
   */
  private async evalTarget(
    frame: unknown,
  ): Promise<{ sessionId?: string; contextId?: number; fallback?: () => Promise<{ sessionId?: string; contextId?: number }> }> {
    if (frame === undefined) return {}
    const where = typeof frame === 'string' ? this.frames.get(frame) : undefined
    if (where === undefined || !(await this.isLive(where))) throw new Error(STALE_REF)
    const session = where.sessionId !== undefined ? { sessionId: where.sessionId } : {}
    const frameId = where.frameId
    if (frameId === undefined) return session
    const isolated = async () => {
      const world = await this.cdp.send('Page.createIsolatedWorld', { frameId }, where.sessionId)
      return { contextId: world.executionContextId as number, ...session }
    }
    const main = this.mainContexts.get(`${where.sessionId ?? ''}\0${frameId}`)
    if (main !== undefined) return { contextId: main, ...session, fallback: isolated }
    return isolated()
  }

  /** Scrolls each frame owner up the chain into view in its parent session, innermost first. */
  private async scrollOwners(sessionId: string): Promise<{ backendNodeId: number; sessionId: string | undefined }[]> {
    const owners: { backendNodeId: number; sessionId: string | undefined }[] = []
    let current: string | undefined = sessionId
    while (current !== undefined) {
      const child = this.frameTracker.get(current)
      if (!child) throw new Error(STALE_REF)
      const owner = await this.cdp.send('DOM.getFrameOwner', { frameId: child.targetId }, child.parentSessionId)
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: owner.backendNodeId }, child.parentSessionId)
      owners.push({ backendNodeId: owner.backendNodeId, sessionId: child.parentSessionId })
      current = child.parentSessionId
    }
    return owners
  }

  /** The top-left of an iframe session's viewport in root-page coordinates, summing each frame owner box. */
  private async ownerOffset(owners: { backendNodeId: number; sessionId: string | undefined }[]): Promise<{ x: number; y: number }> {
    let x = 0
    let y = 0
    for (const owner of owners) {
      const box = await this.cdp.send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId }, owner.sessionId)
      const [ox = 0, oy = 0]: number[] = box.model.content
      x += ox
      y += oy
    }
    return { x, y }
  }

  /** Enables the usual domains inside a freshly attached iframe and lets it auto-attach its own children. */
  private async setupChild(sessionId: string): Promise<void> {
    try {
      for (const domain of CHILD_DOMAINS) await this.cdp.send(`${domain}.enable`, undefined, sessionId)
      // Its own catch: an iframe without interception still wants the emulation below.
      await this.cdp.send('Fetch.enable', { patterns: this.patterns() }, sessionId).catch(() => undefined)
      // Always, so the iframe gets the clean default user agent and its client hints too.
      await this.queueEmulation(() => this.applyEmulation(this.emulationState, [sessionId]))
      await this.cdp.send(
        'Target.setAutoAttach',
        { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
        sessionId,
      )
    } catch {
      // The iframe may already be gone; its detach event cleans up.
    }
  }

  /** The page's AX tree followed by one section per child frame, same-process or out-of-process. */
  private async collectSections(): Promise<FrameSection[]> {
    const sections: FrameSection[] = [{ nodes: await this.axNodes(undefined, undefined) }]
    await this.collectChildren(undefined, sections)
    return sections
  }

  private async axNodes(sessionId: string | undefined, frameId: string | undefined): Promise<AXNode[]> {
    const tree = await this.cdp.send(
      'Accessibility.getFullAXTree',
      frameId !== undefined ? { frameId } : undefined,
      sessionId,
    )
    return (tree.nodes ?? []) as AXNode[]
  }

  private frameLabel(where: FrameRef): string {
    for (const [label, known] of this.frames) {
      if (known.sessionId === where.sessionId && known.frameId === where.frameId) return label
    }
    const label = `f${++this.frameCounter}`
    this.frames.set(label, where)
    return label
  }

  private async collectChildren(sessionId: string | undefined, sections: FrameSection[]): Promise<void> {
    let root: Dyn
    try {
      root = (await this.cdp.send('Page.getFrameTree', undefined, sessionId)).frameTree
    } catch {
      return
    }
    const seen = new Set<string>()
    const addOutOfProcess = async (childSession: string, url: string): Promise<void> => {
      seen.add(childSession)
      try {
        sections.push({
          nodes: await this.axNodes(childSession, undefined),
          header: { url, label: this.frameLabel({ sessionId: childSession }) },
          sessionId: childSession,
        })
      } catch {
        return
      }
      await this.collectChildren(childSession, sections)
    }
    const walk = async (node: Dyn): Promise<void> => {
      for (const child of node?.childFrames ?? []) {
        const frame = child.frame ?? {}
        const oop = this.frameTracker.childFor(sessionId, frame.id)
        if (oop) {
          await addOutOfProcess(oop.sessionId, frame.url ?? oop.url)
          continue
        }
        try {
          sections.push({
            nodes: await this.axNodes(sessionId, frame.id),
            header: {
              url: frame.url ?? '',
              label: this.frameLabel({ ...(sessionId !== undefined ? { sessionId } : {}), frameId: frame.id }),
            },
            ...(sessionId !== undefined ? { sessionId } : {}),
            frameId: frame.id,
          })
        } catch {
          // A frame can vanish between the tree and its AX read; the snapshot just omits it.
        }
        await walk(child)
      }
    }
    await walk(root)
    // An iframe session the frame tree did not list is still part of the page.
    for (const child of this.frameTracker.list()) {
      if (child.parentSessionId === sessionId && !seen.has(child.sessionId)) await addOutOfProcess(child.sessionId, child.url)
    }
  }

  private async callOn(
    backendNodeId: number,
    functionDeclaration: string,
    argv?: unknown[],
    sessionId?: string,
  ): Promise<void> {
    const node = await this.cdp.send('DOM.resolveNode', { backendNodeId }, sessionId)
    await this.cdp.send(
      'Runtime.callFunctionOn',
      {
        objectId: node.object.objectId,
        functionDeclaration,
        ...(argv ? { arguments: argv } : {}),
      },
      sessionId,
    )
  }

  /**
   * The rules' patterns, then the secure documents, which are always paused: Electron gives no client
   * hints to navigations (only the renderer adds them, to subresources), so the driver adds them.
   */
  private patterns(): { urlPattern: string; requestStage: 'Request' | 'Response'; resourceType?: string }[] {
    return [
      ...this.rules.map((r) => ({ urlPattern: r.urlPattern, requestStage: r.stage === 'response' ? ('Response' as const) : ('Request' as const) })),
      ...HINTED_DOCUMENTS.map((urlPattern) => ({ urlPattern, resourceType: 'Document', requestStage: 'Request' as const })),
    ]
  }

  /** The client hints a paused request lacks, which is none unless it is a secure document. */
  private async missingHints(p: Dyn): Promise<HeaderEntry[]> {
    if (p.resourceType !== 'Document' || !sendsClientHints(String(p.request?.url ?? ''))) return []
    const defaultUserAgent = this.emulationState.userAgent === undefined ? await this.defaultUserAgent() : ''
    return clientHintHeaders(effectiveUserAgentMetadata(this.emulationState, defaultUserAgent))
  }

  /** Replaces the rewrite rules and updates Fetch interception in the page and every iframe session. */
  private async setRules(raw: unknown): Promise<Rule[]> {
    const input = Array.isArray(raw) ? (raw as Rule[]) : []
    this.rules = input.map((r) => ({ ...r, id: r.id ?? `r${++this.ruleCounter}` }))
    this.opts.onRules?.(this.rules)
    const sessions = [undefined, ...this.frameTracker.list().map((c) => c.sessionId)]
    for (const sessionId of sessions) {
      try {
        await this.cdp.send('Fetch.enable', { patterns: this.patterns() }, sessionId)
      } catch (err) {
        if (sessionId === undefined) throw err
        // An iframe session may already be gone.
      }
    }
    return this.rules
  }

  /** Answers a paused request in the session it paused in. Whatever happens, the request is released. */
  private async onPaused(p: Dyn, sessionId?: string): Promise<void> {
    const requestId = p?.requestId
    if (typeof requestId !== 'string') return
    try {
      if (p.responseErrorReason !== undefined && p.responseStatusCode === undefined) {
        // The response failed before it had a status; there is nothing to rewrite.
        await this.cdp.send('Fetch.continueRequest', { requestId }, sessionId)
        return
      }
      const stage = p.responseStatusCode !== undefined ? 'response' : 'request'
      const req = p.request ?? {}
      const sent: HeaderEntry[] = Object.entries(req.headers ?? {}).map(([name, value]) => ({ name, value: String(value) }))
      // Hints go in before any rule, so a rule that sets or removes one still has the last word.
      const hinted = stage === 'request' ? withClientHints(sent, await this.missingHints(p)) : sent
      const rule = matchRule(this.rules, { url: String(req.url ?? ''), method: String(req.method ?? 'GET'), stage })
      if (!rule) {
        await this.cdp.send('Fetch.continueRequest', { requestId, ...(hinted.length > sent.length ? { headers: hinted } : {}) }, sessionId)
        return
      }
      const mark = (headers: HeaderEntry[]) => {
        if (typeof p.networkId === 'string' && rule.id) this.network.markRewritten(p.networkId, rule.id, headers)
      }
      if (stage === 'request') {
        if (rule.status !== undefined) {
          const responseHeaders = mergeHeaders([], rule.setHeaders)
          mark(responseHeaders)
          await this.cdp.send(
            'Fetch.fulfillRequest',
            {
              requestId,
              responseCode: rule.status,
              responseHeaders,
              body: Buffer.from(rule.body ?? '').toString('base64'),
            },
            sessionId,
          )
          return
        }
        const headers = mergeHeaders(hinted, rule.setHeaders)
        mark(headers)
        await this.cdp.send(
          'Fetch.continueRequest',
          {
            requestId,
            headers,
            ...(rule.body !== undefined ? { postData: Buffer.from(rule.body).toString('base64') } : {}),
          },
          sessionId,
        )
        return
      }
      let body: string
      if (rule.body !== undefined) {
        body = Buffer.from(rule.body).toString('base64')
      } else {
        const got = await this.cdp.send('Fetch.getResponseBody', { requestId }, sessionId)
        body = got.base64Encoded === true ? String(got.body ?? '') : Buffer.from(String(got.body ?? '')).toString('base64')
      }
      // The body is now plain bytes of a new length, so the original encoding and length no longer apply.
      const base: HeaderEntry[] = ((p.responseHeaders ?? []) as HeaderEntry[]).filter(
        (h) => !['content-encoding', 'content-length'].includes(h.name.toLowerCase()),
      )
      const responseHeaders = mergeHeaders(base, rule.setHeaders)
      mark(responseHeaders)
      await this.cdp.send(
        'Fetch.fulfillRequest',
        {
          requestId,
          responseCode: rule.status ?? p.responseStatusCode,
          responseHeaders,
          body,
        },
        sessionId,
      )
    } catch (err) {
      this.log.push({ kind: 'error', text: `Rewrite rule failed: ${err instanceof Error ? err.message : String(err)}`, url: this.url })
      try {
        await this.cdp.send('Fetch.continueRequest', { requestId }, sessionId)
      } catch {
        // The request is already gone; nothing is left to release.
      }
    }
  }

  private async onDialog(p: Dyn, sessionId?: string): Promise<void> {
    const entry: LogEntry = this.log.push({
      kind: 'dialog',
      text: p.message ?? '',
      url: p.url ?? this.frameTracker.urlOf(sessionId, this.url),
      dialogType: p.type,
    })
    const decision = this.policy.decide()
    if (decision.by === 'agent') {
      entry.handledBy = 'agent'
      await this.answer(decision.accept, decision.promptText, sessionId)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), this.operatorTimeoutMs)
    })
    const asked = this.opts
      .askOperator({ type: p.type, message: p.message ?? '', defaultPrompt: p.defaultPrompt ?? '', url: p.url ?? this.frameTracker.urlOf(sessionId, this.url) })
      .catch(() => ({ accept: false }) as { accept: boolean; promptText?: string })
    const result = await Promise.race([asked, timeout])
    clearTimeout(timer)
    if (result === 'timeout') {
      entry.handledBy = 'timeout'
      await this.answer(false, undefined, sessionId)
    } else {
      entry.handledBy = 'operator'
      await this.answer(result.accept, result.promptText, sessionId)
    }
  }

  private async answer(accept: boolean, promptText?: string, sessionId?: string): Promise<void> {
    try {
      await this.cdp.send('Page.handleJavaScriptDialog', { accept, promptText }, sessionId)
    } catch {
      // The dialog may already be gone (page navigated or closed); nothing left to answer.
    }
  }
}
