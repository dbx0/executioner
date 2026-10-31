import { afterEach, describe, expect, it, vi } from 'vitest'
import { STALE_REF } from '@exe/protocol'
import { bodyWindow, CdpDriver, type Cdp, type Dyn } from './cdp-driver'
import { geolocationShim, userAgentMetadata } from './emulation'

/** The Fetch patterns that pause secure documents for their client hints, after any rule's. */
const HINT_PATTERNS = ['https://*', 'http://localhost*', 'http://*.localhost*', 'http://127.*', 'http://[::1]*'].map((urlPattern) => ({
  urlPattern,
  resourceType: 'Document',
  requestStage: 'Request',
}))

const ua = (userAgent: string, extra: Record<string, unknown> = {}) => ({ userAgent, ...extra, userAgentMetadata: userAgentMetadata(userAgent) })

type Handler = (params?: Record<string, unknown>, sessionId?: string) => Dyn

class FakeCdp implements Cdp {
  calls: { method: string; params?: Record<string, unknown> | undefined; sessionId?: string | undefined }[] = []
  handlers = new Map<string, Handler>()
  private listeners = new Map<string, Set<(p: Dyn, sessionId?: string) => void>>()

  async send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Dyn> {
    this.calls.push({ method, params, sessionId })
    const h = this.handlers.get(method)
    return h ? h(params, sessionId) : {}
  }
  on(event: string, cb: (p: Dyn, sessionId?: string) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb)
    this.listeners.set(event, set)
    return () => set.delete(cb)
  }
  emit(event: string, params: Dyn, sessionId?: string): void {
    for (const cb of this.listeners.get(event) ?? []) cb(params, sessionId)
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
  sent(prefix: string) {
    return this.calls.filter((c) => c.method.startsWith(prefix))
  }
}

const tree = {
  nodes: [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'T' }, childIds: ['2'], backendDOMNodeId: 1 },
    { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 42 },
  ],
}

function setup(opts: { operatorTimeoutMs?: number | undefined; ask?: () => Promise<{ accept: boolean }> } = {}) {
  const cdp = new FakeCdp()
  cdp.handlers.set('Accessibility.getFullAXTree', () => tree)
  cdp.handlers.set('DOM.getBoxModel', () => ({ model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } }))
  cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: ['http://x/', 'T'] } }))
  const askOperator = vi.fn(opts.ask ?? (async () => ({ accept: true })))
  const driver = new CdpDriver(cdp, { askOperator, operatorTimeoutMs: opts.operatorTimeoutMs })
  return { cdp, driver, askOperator }
}

const dialog = { type: 'alert', message: 'hey', defaultPrompt: '', url: 'http://x/' }

afterEach(() => vi.useRealTimers())

describe('CdpDriver', () => {
  it('click resolves the ref and sends press and release at the box centre', async () => {
    const { cdp, driver } = setup()
    await driver.start()
    await driver.run('snapshot', {})
    await driver.run('click', { ref: 'g1e2' })
    expect(cdp.sent('DOM.scrollIntoViewIfNeeded')[0]?.params).toEqual({ backendNodeId: 42 })
    const mouse = cdp.sent('Input.dispatchMouseEvent').map((c) => c.params)
    expect(mouse).toEqual([
      { type: 'mousePressed', x: 20, y: 30, button: 'left', clickCount: 1 },
      { type: 'mouseReleased', x: 20, y: 30, button: 'left', clickCount: 1 },
    ])
  })

  it('refs from before a navigation are stale', async () => {
    const { cdp, driver } = setup()
    await driver.start()
    await driver.run('snapshot', {})
    cdp.emit('Page.frameNavigated', { frame: { id: 'main', url: 'http://x/2' } })
    await expect(driver.run('click', { ref: 'g1e2' })).rejects.toThrow(STALE_REF)
    expect(cdp.sent('Input.')).toHaveLength(0)
  })

  it('a ref whose node is gone is stale', async () => {
    const { cdp, driver } = setup()
    cdp.handlers.set('DOM.getBoxModel', () => {
      throw new Error('Could not compute box model')
    })
    await driver.start()
    await driver.run('snapshot', {})
    await expect(driver.run('click', { ref: 'g1e2' })).rejects.toThrow(STALE_REF)
    expect(cdp.sent('Input.')).toHaveLength(0)
  })

  it('a dialog during a call is dismissed for the agent and logged', async () => {
    const { cdp, driver, askOperator } = setup()
    cdp.handlers.set('Runtime.evaluate', () => {
      cdp.emit('Page.javascriptDialogOpening', dialog)
      return { result: { value: 1 } }
    })
    await driver.start()
    await driver.run('eval', { expression: 'alert(1)' })
    expect(cdp.sent('Page.handleJavaScriptDialog')[0]?.params).toEqual({ accept: false, promptText: undefined })
    expect(askOperator).not.toHaveBeenCalled()
    const entry = driver.log.since().entries.find((e) => e.kind === 'dialog')
    expect(entry).toMatchObject({ dialogType: 'alert', text: 'hey', handledBy: 'agent' })
  })

  it('dialogs outside the agent window go to the operator and are logged', async () => {
    const { cdp, driver, askOperator } = setup({ ask: async () => ({ accept: true, promptText: 'x' }) })
    await driver.start()
    cdp.emit('Page.javascriptDialogOpening', { ...dialog, type: 'confirm' })
    await vi.waitFor(() => expect(cdp.sent('Page.handleJavaScriptDialog')).toHaveLength(1))
    expect(askOperator).toHaveBeenCalledOnce()
    expect(cdp.sent('Page.handleJavaScriptDialog')[0]?.params).toEqual({ accept: true, promptText: 'x' })
    expect(driver.log.since().entries.find((e) => e.kind === 'dialog')).toMatchObject({ handledBy: 'operator' })
  })

  it('an unanswered operator dialog is dismissed after the timeout', async () => {
    vi.useFakeTimers()
    const { cdp, driver } = setup({ operatorTimeoutMs: 20, ask: () => new Promise(() => {}) })
    await driver.start()
    cdp.emit('Page.javascriptDialogOpening', dialog)
    await vi.advanceTimersByTimeAsync(20)
    expect(cdp.sent('Page.handleJavaScriptDialog')[0]?.params).toMatchObject({ accept: false })
    expect(driver.log.since().entries.find((e) => e.kind === 'dialog')).toMatchObject({ handledBy: 'timeout' })
  })

  it('eval returns the value and rejects with the exception text', async () => {
    const { cdp, driver } = setup()
    cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: 7 } }))
    await driver.start()
    expect(await driver.run('eval', { expression: '3+4' })).toEqual({ value: 7 })
    cdp.handlers.set('Runtime.evaluate', () => ({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'ReferenceError: nope is not defined' } },
    }))
    await expect(driver.run('eval', { expression: 'nope' })).rejects.toThrow(
      'Uncaught: ReferenceError: nope is not defined',
    )
  })

  it('ensure navigates when given a url', async () => {
    const { cdp, driver } = setup()
    await driver.start()
    const p = driver.run('ensure', { url: 'http://x/' })
    await vi.waitFor(() => expect(cdp.sent('Page.navigate')).toHaveLength(1))
    cdp.emit('Page.loadEventFired', {})
    expect(await p).toEqual({ url: 'http://x/', title: 'T' })
    expect(cdp.sent('Page.navigate')[0]?.params).toEqual({ url: 'http://x/' })
  })

  it('navigate rejects at once on an errorText', async () => {
    const { cdp, driver } = setup()
    cdp.handlers.set('Page.navigate', () => ({ errorText: 'net::ERR_NAME_NOT_RESOLVED' }))
    await driver.start()
    await expect(driver.run('navigate', { url: 'http://nope.invalid/' })).rejects.toThrow('net::ERR_NAME_NOT_RESOLVED')
  })

  it('refs from an earlier snapshot keep pointing at their own node', async () => {
    const { cdp, driver } = setup()
    await driver.start()
    await driver.run('snapshot', {})
    cdp.handlers.set('Accessibility.getFullAXTree', () => ({
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'], backendDOMNodeId: 1 },
        { nodeId: '2', parentId: '1', role: { value: 'link' }, name: { value: 'Other' }, backendDOMNodeId: 99 },
      ],
    }))
    const second = (await driver.run('snapshot', {})) as { snapshot: string }
    expect(second.snapshot).not.toContain('[ref=g1e2]')
    await driver.run('click', { ref: 'g1e2' })
    expect(cdp.sent('DOM.scrollIntoViewIfNeeded')[0]?.params).toEqual({ backendNodeId: 42 })
  })

  it('wait returns matched false on timeout', async () => {
    const { cdp, driver } = setup()
    cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: false } }))
    await driver.start()
    const res = await driver.run('wait', { selector: '#nope', timeoutMs: 150 })
    expect(res).toMatchObject({ matched: false })
  })

  it('console messages land in the log', async () => {
    const { cdp, driver } = setup()
    await driver.start()
    cdp.emit('Runtime.consoleAPICalled', {
      type: 'warning',
      args: [{ value: 'a' }, { description: 'Object' }],
    })
    const res = (await driver.run('log', {})) as { entries: { text: string; level: string }[]; next: number }
    expect(res.entries).toMatchObject([{ kind: 'console', level: 'warning', text: 'a Object' }])
    expect(res.next).toBe(1)
  })

  it('a failed navigate cleans up only its own load wait', async () => {
    const { cdp, driver } = setup()
    await driver.start()
    let failNavigate: (v: Dyn) => void = () => {}
    cdp.handlers.set('Page.navigate', () => new Promise<Dyn>((r) => (failNavigate = r)))
    const nav = driver.run('navigate', { url: 'http://bad/' })
    const navResult = nav.then(
      () => 'resolved',
      (e: Error) => e.message,
    )
    await Promise.resolve()
    let waited: unknown
    const wait = driver.run('wait', { timeoutMs: 200 }).then((v) => (waited = v))
    await new Promise((r) => setTimeout(r, 0))
    expect(cdp.listenerCount('Page.loadEventFired')).toBe(2)
    failNavigate({ errorText: 'net::ERR_FAILED' })
    expect(await navResult).toBe('net::ERR_FAILED')
    await new Promise((r) => setTimeout(r, 20))
    expect(waited).toBeUndefined()
    expect(cdp.listenerCount('Page.loadEventFired')).toBe(1)
    cdp.emit('Page.loadEventFired', {})
    await wait
    expect(waited).toMatchObject({ matched: true })
    expect(cdp.listenerCount('Page.loadEventFired')).toBe(0)
  })

  it('a throwing Page.navigate removes its load listener', async () => {
    const { cdp, driver } = setup()
    await driver.start()
    cdp.handlers.set('Page.navigate', () => {
      throw new Error('navigate boom')
    })
    await expect(driver.run('navigate', { url: 'http://x/' })).rejects.toThrow('navigate boom')
    expect(cdp.listenerCount('Page.loadEventFired')).toBe(0)
  })

  describe('iframes', () => {
    const attach = (cdp: FakeCdp, sessionId: string, targetId: string, parent?: string) =>
      cdp.emit(
        'Target.attachedToTarget',
        { sessionId, targetInfo: { targetId, type: 'iframe', url: 'http://frame/' } },
        parent,
      )
    const childTree = {
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'C' }, childIds: ['2'], backendDOMNodeId: 5 },
        { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Inner' }, backendDOMNodeId: 77 },
      ],
    }
    const frameTree = (...children: Dyn[]) => ({
      frameTree: { frame: { id: 'main' }, childFrames: children.map((frame) => ({ frame })) },
    })

    function iframeSetup() {
      const s = setup()
      s.cdp.handlers.set('Page.getFrameTree', (_p, sessionId) => (sessionId ? frameTree() : frameTree({ id: 'F1', url: 'http://frame/' })))
      s.cdp.handlers.set('Accessibility.getFullAXTree', (_p, sessionId) => (sessionId === 'S1' ? childTree : tree))
      return s
    }

    it('auto-attaches on start and sets up each iframe session', async () => {
      const { cdp, driver } = iframeSetup()
      await driver.start()
      expect(cdp.sent('Target.setAutoAttach')[0]).toMatchObject({
        params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      })
      attach(cdp, 'S1', 'F1')
      await vi.waitFor(() => expect(cdp.sent('Target.setAutoAttach')).toHaveLength(2))
      const inChild = cdp.calls.filter((c) => c.sessionId === 'S1').map((c) => c.method)
      expect(inChild).toEqual(
        expect.arrayContaining(['Runtime.enable', 'DOM.enable', 'Accessibility.enable', 'Page.enable', 'Target.setAutoAttach']),
      )
    })

    it('snapshot includes out-of-process iframe sections with their own refs', async () => {
      const { cdp, driver } = iframeSetup()
      await driver.start()
      attach(cdp, 'S1', 'F1')
      const res = (await driver.run('snapshot', {})) as { snapshot: string }
      expect(res.snapshot.split('\n')).toEqual([
        '- RootWebArea "T" [ref=g1e1]',
        '  - button "Go" [ref=g1e2]',
        '- frame "http://frame/" [frame=f1]',
        '  - RootWebArea "C" [ref=g1e3]',
        '    - button "Inner" [ref=g1e4]',
      ])
      await driver.run('click', { ref: 'g1e4' })
      expect(cdp.sent('DOM.scrollIntoViewIfNeeded').find((c) => c.sessionId === 'S1')).toMatchObject({ params: { backendNodeId: 77 }, sessionId: 'S1' })
    })

    it('click in an iframe offsets by the frame owner box', async () => {
      const { cdp, driver } = iframeSetup()
      cdp.handlers.set('DOM.getFrameOwner', (p, sessionId) =>
        p?.frameId === 'F1' && sessionId === undefined ? { backendNodeId: 7 } : {},
      )
      cdp.handlers.set('DOM.getBoxModel', (p, sessionId) =>
        sessionId === 'S1'
          ? { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } }
          : p?.backendNodeId === 7
            ? { model: { content: [100, 200, 300, 200, 300, 400, 100, 400] } }
            : { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } },
      )
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await driver.run('snapshot', {})
      await driver.run('click', { ref: 'g1e4' })
      const mouse = cdp.sent('Input.dispatchMouseEvent')
      expect(mouse.map((c) => c.params)).toEqual([
        { type: 'mousePressed', x: 120, y: 230, button: 'left', clickCount: 1 },
        { type: 'mouseReleased', x: 120, y: 230, button: 'left', clickCount: 1 },
      ])
      expect(mouse.every((c) => c.sessionId === undefined)).toBe(true)
      // The owner element is scrolled into view in its parent session before any box is read.
      const calls = cdp.calls.map((c) => `${c.method}:${c.params?.backendNodeId ?? ''}:${c.sessionId ?? ''}`)
      const ownerScroll = calls.indexOf('DOM.scrollIntoViewIfNeeded:7:')
      expect(ownerScroll).toBeGreaterThan(-1)
      expect(calls.indexOf('DOM.getBoxModel:7:')).toBeGreaterThan(ownerScroll)
      expect(calls.indexOf('DOM.getBoxModel:77:S1')).toBeGreaterThan(ownerScroll)
    })

    it('click in a nested iframe adds every owner box up the chain', async () => {
      const { cdp, driver } = iframeSetup()
      cdp.handlers.set('Page.getFrameTree', (_p, sessionId) =>
        sessionId === 'S1' ? frameTree({ id: 'F2', url: 'http://deep/' }) : frameTree({ id: 'F1', url: 'http://frame/' }),
      )
      cdp.handlers.set('Accessibility.getFullAXTree', (_p, sessionId) => (sessionId === 'S2' ? childTree : sessionId ? { nodes: [] } : tree))
      cdp.handlers.set('DOM.getFrameOwner', (p) => ({ backendNodeId: p?.frameId === 'F1' ? 7 : 8 }))
      cdp.handlers.set('DOM.getBoxModel', (p, sessionId) => {
        if (sessionId === 'S2') return { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } }
        const origin = p?.backendNodeId === 8 ? 5 : 100
        return { model: { content: [origin, origin, 0, 0, 0, 0, 0, 0] } }
      })
      await driver.start()
      attach(cdp, 'S1', 'F1')
      attach(cdp, 'S2', 'F2', 'S1')
      await driver.run('snapshot', {})
      await driver.run('click', { ref: 'g1e4' })
      expect(cdp.sent('Input.dispatchMouseEvent')[0]?.params).toMatchObject({ x: 20 + 5 + 100, y: 30 + 5 + 100 })
    })

    it('a ref in a detached frame is stale', async () => {
      const { cdp, driver } = iframeSetup()
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await driver.run('snapshot', {})
      cdp.emit('Target.detachedFromTarget', { sessionId: 'S1' })
      await expect(driver.run('click', { ref: 'g1e4' })).rejects.toThrow(STALE_REF)
      expect(cdp.sent('Input.')).toHaveLength(0)
      expect(cdp.sent('DOM.scrollIntoViewIfNeeded').every((c) => c.sessionId === undefined)).toBe(true)
    })

    it('a ref in a same-process frame that left the tree is stale', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Page.getFrameTree', () => frameTree({ id: 'G1', url: 'http://same/' }))
      cdp.handlers.set('Accessibility.getFullAXTree', (p) => (p?.frameId === 'G1' ? childTree : tree))
      await driver.start()
      await driver.run('snapshot', {})
      cdp.handlers.set('Page.getFrameTree', () => frameTree())
      await expect(driver.run('click', { ref: 'g1e4' })).rejects.toThrow(STALE_REF)
      expect(cdp.sent('Input.')).toHaveLength(0)
    })

    it('console from an iframe session lands in the log with the frame url', async () => {
      const { cdp, driver } = iframeSetup()
      await driver.start()
      attach(cdp, 'S1', 'F1')
      cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'hi' }] }, 'S1')
      cdp.emit('Runtime.exceptionThrown', { exceptionDetails: { text: 'boom' } }, 'S1')
      const res = (await driver.run('log', {})) as { entries: { url: string; text: string; kind: string }[] }
      expect(res.entries).toMatchObject([
        { kind: 'console', text: 'hi', url: 'http://frame/' },
        { kind: 'error', text: 'boom', url: 'http://frame/' },
      ])
    })

    it('a dialog in an iframe is answered in its own session', async () => {
      const { cdp, driver } = iframeSetup()
      await driver.start()
      attach(cdp, 'S1', 'F1')
      cdp.emit('Page.javascriptDialogOpening', { ...dialog, url: 'http://frame/' }, 'S1')
      await vi.waitFor(() => expect(cdp.sent('Page.handleJavaScriptDialog')).toHaveLength(1))
      expect(cdp.sent('Page.handleJavaScriptDialog')[0]?.sessionId).toBe('S1')
    })

    it('an iframe dialog without a url is reported with the frame url', async () => {
      const { cdp, driver, askOperator } = iframeSetup()
      await driver.start()
      attach(cdp, 'S1', 'F1')
      cdp.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'hey', defaultPrompt: '' }, 'S1')
      await vi.waitFor(() => expect(askOperator).toHaveBeenCalled())
      expect(askOperator).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://frame/' }))
    })

    it('root events with an empty session id are treated as the root session', async () => {
      const { cdp, driver } = iframeSetup()
      cdp.handlers.set('DOM.getFrameOwner', () => ({ backendNodeId: 7 }))
      cdp.handlers.set('DOM.getBoxModel', (p, sessionId) =>
        sessionId === undefined && p?.backendNodeId === 7
          ? { model: { content: [100, 200, 300, 200, 300, 400, 100, 400] } }
          : { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } },
      )
      await driver.start()
      cdp.emit('Target.attachedToTarget', { sessionId: 'S1', targetInfo: { targetId: 'F1', type: 'iframe', url: 'http://frame/' } }, '')
      const snap = (await driver.run('snapshot', {})) as { snapshot: string }
      expect(snap.snapshot).toContain('[frame=f1]')
      await driver.run('click', { ref: 'g1e4' })
      expect(cdp.sent('Input.dispatchMouseEvent')[0]?.params).toMatchObject({ x: 120, y: 230 })
      cdp.emit('Page.frameNavigated', { frame: { id: 'main', url: 'http://x/2' } }, '')
      await expect(driver.run('click', { ref: 'g1e2' })).rejects.toThrow(STALE_REF)
      cdp.handlers.set('Page.navigate', () => ({}))
      const nav = driver.run('navigate', { url: 'http://x/' })
      await vi.waitFor(() => expect(cdp.sent('Page.navigate')).toHaveLength(1))
      cdp.emit('Page.loadEventFired', {}, '')
      await expect(nav).resolves.toMatchObject({ url: 'http://x/' })
    })

    it('an iframe navigation does not invalidate the page refs', async () => {
      const { cdp, driver } = iframeSetup()
      await driver.start()
      await driver.run('snapshot', {})
      cdp.emit('Page.frameNavigated', { frame: { id: 'F1', url: 'http://frame/2' } }, 'S1')
      await driver.run('click', { ref: 'g1e2' })
      expect(cdp.sent('Input.dispatchMouseEvent')).toHaveLength(2)
    })

    it('eval runs in the given frame', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Page.getFrameTree', (_p, sessionId) =>
        sessionId ? frameTree() : frameTree({ id: 'F1', url: 'http://frame/' }, { id: 'G1', url: 'http://same/' }),
      )
      cdp.handlers.set('Accessibility.getFullAXTree', (p, sessionId) => (sessionId === 'S1' || p?.frameId === 'G1' ? childTree : tree))
      cdp.handlers.set('Page.createIsolatedWorld', () => ({ executionContextId: 9 }))
      cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: 'v' } }))
      await driver.start()
      attach(cdp, 'S1', 'F1')
      const snap = (await driver.run('snapshot', {})) as { snapshot: string }
      expect(snap.snapshot).toContain('[frame=f1]')
      expect(snap.snapshot).toContain('[frame=f2]')

      expect(await driver.run('eval', { expression: '1', frame: 'f1' })).toEqual({ value: 'v' })
      expect(cdp.sent('Runtime.evaluate').at(-1)).toMatchObject({ params: { expression: '1' }, sessionId: 'S1' })

      expect(await driver.run('eval', { expression: '2', frame: 'f2' })).toEqual({ value: 'v' })
      expect(cdp.sent('Page.createIsolatedWorld')[0]?.params).toMatchObject({ frameId: 'G1' })
      expect(cdp.sent('Runtime.evaluate').at(-1)).toMatchObject({ params: { expression: '2', contextId: 9 } })

      await expect(driver.run('eval', { expression: '3', frame: 'f9' })).rejects.toThrow(STALE_REF)
    })
  })
  describe('network and rewrite', () => {
    const paused = (extra: Record<string, unknown> = {}) => ({
      requestId: 'P1',
      networkId: 'N1',
      request: { url: 'http://x/api', method: 'GET', headers: { Accept: '*/*', 'X-Old': '1' } },
      ...extra,
    })
    const rewrite = (driver: CdpDriver, rules: Dyn[]) => driver.run('rewrite', { rules })
    const attach = (cdp: FakeCdp, sessionId: string, targetId: string) =>
      cdp.emit('Target.attachedToTarget', { sessionId, targetInfo: { targetId, type: 'iframe', url: 'http://frame/' } }, '')
    const settle = () => new Promise((r) => setTimeout(r, 0))

    it('a request-stage rule sets and removes headers', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      cdp.emit('Network.requestWillBeSent', { requestId: 'N1', request: { method: 'GET', url: 'http://x/api', headers: {} } }, '')
      const res = (await rewrite(driver, [{ urlPattern: 'http://x/*', setHeaders: { accept: 'text/html', 'x-old': null, 'X-A': 'b' }, body: 'hi' }])) as { rules: Dyn[] }
      expect(res.rules[0].id).toBe('r1')
      expect(cdp.sent('Fetch.enable').at(-1)?.params).toEqual({ patterns: [{ urlPattern: 'http://x/*', requestStage: 'Request' }, ...HINT_PATTERNS] })
      cdp.emit('Fetch.requestPaused', paused(), '')
      await vi.waitFor(() => expect(cdp.sent('Fetch.continueRequest')).toHaveLength(1))
      expect(cdp.sent('Fetch.continueRequest')[0]?.params).toEqual({
        requestId: 'P1',
        headers: [
          { name: 'accept', value: 'text/html' },
          { name: 'X-A', value: 'b' },
        ],
        postData: Buffer.from('hi').toString('base64'),
      })
      const net = (await driver.run('network', {})) as { entries: Dyn[]; url: string }
      expect(net.entries[0].rewrittenBy).toBe('r1')
      expect(net.entries[0].rewrittenHeaders).toEqual({ accept: 'text/html', 'X-A': 'b' })
      expect(net.url).toBe('http://x/')
    })

    it('a status rule fulfils without the network', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await rewrite(driver, [{ urlPattern: '*', status: 503, body: 'down', setHeaders: { 'X-A': 'b' } }])
      cdp.emit('Fetch.requestPaused', paused(), '')
      await vi.waitFor(() => expect(cdp.sent('Fetch.fulfillRequest')).toHaveLength(1))
      expect(cdp.sent('Fetch.fulfillRequest')[0]?.params).toEqual({
        requestId: 'P1',
        responseCode: 503,
        responseHeaders: [{ name: 'X-A', value: 'b' }],
        body: Buffer.from('down').toString('base64'),
      })
      expect(cdp.sent('Fetch.continueRequest')).toHaveLength(0)
    })

    it('a response-stage rule without a body fulfils with the network body and merged headers', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Fetch.getResponseBody', () => ({ body: 'orig', base64Encoded: false }))
      await driver.start()
      await rewrite(driver, [{ urlPattern: '*', stage: 'response', setHeaders: { 'X-A': 'b' } }])
      expect(cdp.sent('Fetch.enable').at(-1)?.params).toEqual({
        patterns: [{ urlPattern: '*', requestStage: 'Response' }, ...HINT_PATTERNS],
      })
      cdp.emit(
        'Fetch.requestPaused',
        paused({ responseStatusCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }, { name: 'Content-Length', value: '4' }] }),
        '',
      )
      await vi.waitFor(() => expect(cdp.sent('Fetch.fulfillRequest')).toHaveLength(1))
      expect(cdp.sent('Fetch.fulfillRequest')[0]?.params).toEqual({
        requestId: 'P1',
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/plain' },
          { name: 'X-A', value: 'b' },
        ],
        body: Buffer.from('orig').toString('base64'),
      })
    })

    it('a response-stage rule replaces the body', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await rewrite(driver, [{ urlPattern: '*/api', stage: 'response', body: 'new', status: 201, setHeaders: { 'X-A': 'b' } }])
      cdp.emit(
        'Fetch.requestPaused',
        paused({ responseStatusCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }, { name: 'content-length', value: '4' }] }),
        '',
      )
      await vi.waitFor(() => expect(cdp.sent('Fetch.fulfillRequest')).toHaveLength(1))
      expect(cdp.sent('Fetch.fulfillRequest')[0]?.params).toEqual({
        requestId: 'P1',
        responseCode: 201,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/plain' },
          { name: 'X-A', value: 'b' },
        ],
        body: Buffer.from('new').toString('base64'),
      })
      expect(cdp.sent('Fetch.getResponseBody')).toHaveLength(0)
    })

    it('a pause with a response error is continued without logging an error', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await rewrite(driver, [{ urlPattern: '*', stage: 'response' }])
      cdp.emit('Fetch.requestPaused', paused({ responseErrorReason: 'Failed' }), 'S1')
      await vi.waitFor(() => expect(cdp.sent('Fetch.continueRequest')).toHaveLength(1))
      expect(cdp.sent('Fetch.continueRequest')[0]).toMatchObject({ params: { requestId: 'P1' }, sessionId: 'S1' })
      expect(cdp.sent('Fetch.getResponseBody')).toHaveLength(0)
      expect(cdp.sent('Fetch.fulfillRequest')).toHaveLength(0)
      expect(driver.log.since().entries.filter((e) => e.kind === 'error')).toHaveLength(0)
    })

    it('a paused request is continued when a rule fails', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Fetch.getResponseBody', () => {
        throw new Error('no body')
      })
      await driver.start()
      await rewrite(driver, [{ urlPattern: '*', stage: 'response' }])
      cdp.emit('Fetch.requestPaused', paused({ responseStatusCode: 302 }), 'S1')
      await vi.waitFor(() => expect(cdp.sent('Fetch.continueRequest')).toHaveLength(1))
      expect(cdp.sent('Fetch.continueRequest')[0]).toMatchObject({ params: { requestId: 'P1' }, sessionId: 'S1' })
      expect((driver.log.since().entries.at(-1) ?? {}).kind).toBe('error')
    })

    it('an unmatched or failing continue never rejects unhandled', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Fetch.continueRequest', () => {
        throw new Error('gone')
      })
      await driver.start()
      await rewrite(driver, [{ urlPattern: 'http://nomatch/*' }])
      cdp.emit('Fetch.requestPaused', paused(), '')
      await settle()
      expect(cdp.sent('Fetch.continueRequest').length).toBeGreaterThanOrEqual(1)
    })

    it('an empty rule set keeps Fetch on for client hints only', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      expect(cdp.sent('Fetch.enable')[0]?.params).toEqual({ patterns: HINT_PATTERNS })
      await rewrite(driver, [{ urlPattern: '*' }])
      attach(cdp, 'S1', 'F1')
      await driver.run('network', {})
      cdp.calls.length = 0
      await driver.run('rewrite', { rules: [] })
      expect(cdp.sent('Fetch.disable')).toHaveLength(0)
      expect(cdp.sent('Fetch.enable').map((c) => [c.params, c.sessionId])).toEqual([
        [{ patterns: HINT_PATTERNS }, undefined],
        [{ patterns: HINT_PATTERNS }, 'S1'],
      ])
    })

    it('rules reach iframe sessions, including ones attached later', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await rewrite(driver, [{ urlPattern: '*' }])
      attach(cdp, 'S2', 'F2')
      await driver.run('network', {})
      // Start, the iframe's setup, the rule in both sessions, then the later iframe's setup.
      expect(cdp.sent('Fetch.enable').map((c) => c.sessionId)).toEqual([undefined, 'S1', undefined, 'S1', 'S2'])
      expect(cdp.sent('Fetch.enable').at(-1)?.params).toEqual({ patterns: [{ urlPattern: '*', requestStage: 'Request' }, ...HINT_PATTERNS] })
      expect(cdp.sent('Network.enable').map((c) => c.sessionId)).toEqual([undefined, 'S1', 'S2'])
    })

    describe('client hints on navigations', () => {
      const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.31 Safari/537.36'
      const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.31 Safari/537.36'
      const doc = (url: string, headers: Record<string, string> = { Accept: 'text/html' }, extra: Record<string, unknown> = {}) => ({
        requestId: 'P1',
        networkId: 'N1',
        resourceType: 'Document',
        request: { url, method: 'GET', headers },
        ...extra,
      })
      const continued = async (cdp: FakeCdp) => {
        await vi.waitFor(() => expect(cdp.sent('Fetch.continueRequest')).toHaveLength(1))
        const params = cdp.sent('Fetch.continueRequest')[0]?.params
        cdp.calls.length = 0
        return params
      }
      const start = async () => {
        const cdp = new FakeCdp()
        cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: ['https://x/', 'T'] } }))
        const driver = new CdpDriver(cdp, { askOperator: async () => ({ accept: true }), defaultUserAgent: LINUX })
        await driver.start()
        return { cdp, driver }
      }

      it('a secure document gets the hints of the current emulation, the same ones fetch sends', async () => {
        const { cdp, driver } = await start()
        cdp.emit('Fetch.requestPaused', doc('https://x/'), '')
        expect(await continued(cdp)).toEqual({
          requestId: 'P1',
          headers: [
            { name: 'Accept', value: 'text/html' },
            { name: 'sec-ch-ua', value: '"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="99"' },
            { name: 'sec-ch-ua-mobile', value: '?0' },
            { name: 'sec-ch-ua-platform', value: '"Linux"' },
          ],
        })

        await driver.run('emulate', { userAgent: WIN.replace('Safari/537.36', 'Safari/537.36 Edg/146.0.0.0') })
        cdp.calls.length = 0
        cdp.emit('Fetch.requestPaused', doc('https://x/'), 'S1')
        const edge = await continued(cdp)
        expect(edge?.headers).toContainEqual({ name: 'sec-ch-ua', value: '"Chromium";v="146", "Microsoft Edge";v="146", "Not?A_Brand";v="99"' })
        expect(edge?.headers).toContainEqual({ name: 'sec-ch-ua-platform', value: '"Windows"' })

        const meta = { brands: [{ brand: 'Br"and', version: '1' }], platform: 'Android', platformVersion: '14', architecture: 'arm', model: '', mobile: true }
        await driver.run('emulate', { userAgentMetadata: meta })
        cdp.calls.length = 0
        cdp.emit('Fetch.requestPaused', doc('http://127.0.0.1:8080/'), '')
        expect((await continued(cdp))?.headers).toEqual([
          { name: 'Accept', value: 'text/html' },
          { name: 'sec-ch-ua', value: '"Br\\"and";v="1"' },
          { name: 'sec-ch-ua-mobile', value: '?1' },
          { name: 'sec-ch-ua-platform', value: '"Android"' },
        ])

        await driver.run('emulate', { userAgent: null, userAgentMetadata: null })
        cdp.calls.length = 0
        cdp.emit('Fetch.requestPaused', doc('https://x/'), '')
        expect((await continued(cdp))?.headers).toContainEqual({ name: 'sec-ch-ua-platform', value: '"Linux"' })
      })

      it('leaves insecure documents, subresources and hints already present alone', async () => {
        const { cdp } = await start()
        cdp.emit('Fetch.requestPaused', doc('http://x/'), '')
        expect(await continued(cdp)).toEqual({ requestId: 'P1' })
        cdp.emit('Fetch.requestPaused', doc('https://x/a.js', {}, { resourceType: 'Script' }), '')
        expect(await continued(cdp)).toEqual({ requestId: 'P1' })
        const present = { 'Sec-CH-UA': '"X";v="1"', 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Y"' }
        cdp.emit('Fetch.requestPaused', doc('https://x/', present), '')
        expect(await continued(cdp)).toEqual({ requestId: 'P1' })
      })

      it('a request rule still has the last word over a hint', async () => {
        const { cdp, driver } = await start()
        await rewrite(driver, [{ urlPattern: 'https://x/*', setHeaders: { 'sec-ch-ua': null, 'Sec-CH-UA-Platform': '"Plan9"' } }])
        cdp.calls.length = 0
        cdp.emit('Fetch.requestPaused', doc('https://x/'), '')
        expect((await continued(cdp))?.headers).toEqual([
          { name: 'Accept', value: 'text/html' },
          { name: 'sec-ch-ua-mobile', value: '?0' },
          { name: 'Sec-CH-UA-Platform', value: '"Plan9"' },
        ])
      })
    })

    it('response_body caps at 20 000 bytes by default and pages with offset', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Network.getResponseBody', () => ({ body: 'a'.repeat(603_000), base64Encoded: false }))
      await driver.start()
      cdp.emit('Network.requestWillBeSent', { requestId: 'N1', request: { method: 'GET', url: 'http://x/a', headers: {} } }, 'S1')
      const res = (await driver.run('response_body', { requestId: 'N1' })) as Dyn
      expect(res.body).toHaveLength(20_000)
      expect(res).toMatchObject({ truncated: true, base64Encoded: false, totalBytes: 603_000, offset: 0, nextOffset: 20_000 })
      const last = (await driver.run('response_body', { requestId: 'N1', offset: 600_000, maxBytes: 1_000_000 })) as Dyn
      expect(last).toMatchObject({ truncated: false, totalBytes: 603_000, offset: 600_000 })
      expect(last.body).toHaveLength(3000)
      expect(last.nextOffset).toBeUndefined()
      expect(cdp.sent('Network.getResponseBody')[0]).toMatchObject({ params: { requestId: 'N1' }, sessionId: 'S1' })
      await expect(driver.run('response_body', { requestId: 'nope' })).rejects.toThrow(
        'Unknown request id; list requests with browser_network first.',
      )
    })

    it('response_body caps a base64 body by decoded bytes and keeps it decodable', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Network.getResponseBody', () => ({ body: 'QUJD'.repeat(100_000), base64Encoded: true }))
      await driver.start()
      cdp.emit('Network.requestWillBeSent', { requestId: 'N1', request: { method: 'GET', url: 'http://x/a', headers: {} } }, '')
      const res = (await driver.run('response_body', { requestId: 'N1' })) as Dyn
      expect(res).toMatchObject({ truncated: true, base64Encoded: true, totalBytes: 300_000, offset: 0, nextOffset: 20_000 })
      expect(res.body.length % 4).toBe(0)
      const decoded = Buffer.from(res.body as string, 'base64')
      expect(decoded).toHaveLength(20_000)
      expect(decoded.toString()).toBe('ABC'.repeat(6_667).slice(0, 20_000))
      const next = (await driver.run('response_body', { requestId: 'N1', offset: 1, maxBytes: 4 })) as Dyn
      expect(Buffer.from(next.body as string, 'base64').toString()).toBe('BCAB')
    })

    it('bodyWindow cuts text on a character boundary and always moves forward', () => {
      const body = 'é'.repeat(10) // 20 bytes
      const first = bodyWindow({ body }, 0, 5)
      expect(first).toMatchObject({ body: 'éé', offset: 0, nextOffset: 4, totalBytes: 20, truncated: true })
      expect(bodyWindow({ body }, 1, 4)).toMatchObject({ body: 'éé', offset: 2, nextOffset: 6 })
      expect(bodyWindow({ body }, 0, 1)).toMatchObject({ body: 'é', nextOffset: 2 })
      expect(bodyWindow({ body }, 0, 5_000_000).body).toBe(body)
      expect(bodyWindow({ body }, 99, 5)).toMatchObject({ body: '', offset: 20, truncated: false })
    })
  })

  describe('upload, mouse, drag and emulation', () => {
    const attach = (cdp: FakeCdp, sessionId: string, targetId: string) =>
      cdp.emit('Target.attachedToTarget', { sessionId, targetInfo: { targetId, type: 'iframe', url: 'http://frame/' } }, '')
    const mouseEvents = (cdp: FakeCdp) => cdp.sent('Input.dispatchMouseEvent')

    it('upload sets files on the input and dispatches change', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('DOM.resolveNode', () => ({ object: { objectId: 'obj1' } }))
      await driver.start()
      await driver.run('snapshot', {})
      const res = await driver.run('upload', { ref: 'g1e2', paths: ['/tmp/a.txt', '/tmp/b.txt'] })
      expect(res).toEqual({ url: 'http://x/', title: 'T' })
      expect(cdp.sent('DOM.setFileInputFiles')).toEqual([
        { method: 'DOM.setFileInputFiles', params: { files: ['/tmp/a.txt', '/tmp/b.txt'], backendNodeId: 42 }, sessionId: undefined },
      ])
      const fn = cdp.sent('Runtime.callFunctionOn')[0]
      expect(fn?.params?.objectId).toBe('obj1')
      expect(String(fn?.params?.functionDeclaration)).toContain("new Event('input',{bubbles:true})")
      expect(String(fn?.params?.functionDeclaration)).toContain("new Event('change',{bubbles:true})")
      const order = cdp.calls.map((c) => c.method)
      expect(order.indexOf('DOM.setFileInputFiles')).toBeLessThan(order.indexOf('Runtime.callFunctionOn'))
    })

    it('upload in an iframe uses the iframe session', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Page.getFrameTree', (_p, sessionId) => ({
        frameTree: { frame: { id: 'main' }, childFrames: sessionId ? [] : [{ frame: { id: 'F1', url: 'http://frame/' } }] },
      }))
      cdp.handlers.set('Accessibility.getFullAXTree', (_p, sessionId) =>
        sessionId === 'S1'
          ? { nodes: [{ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'C' }, childIds: ['2'], backendDOMNodeId: 5 }, { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Pick' }, backendDOMNodeId: 77 }] }
          : tree,
      )
      cdp.handlers.set('DOM.resolveNode', () => ({ object: { objectId: 'obj1' } }))
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await driver.run('snapshot', {})
      await driver.run('upload', { ref: 'g1e4', paths: ['/tmp/a.txt'] })
      expect(cdp.sent('DOM.setFileInputFiles')[0]).toMatchObject({ params: { files: ['/tmp/a.txt'], backendNodeId: 77 }, sessionId: 'S1' })
      expect(cdp.sent('Runtime.callFunctionOn')[0]?.sessionId).toBe('S1')
    })

    it('mouse click sends move, press and release at the point', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      const res = await driver.run('mouse', { action: 'click', x: 5, y: 6, button: 'right' })
      expect(res).toEqual({ url: 'http://x/', title: 'T' })
      expect(mouseEvents(cdp).map((c) => [c.params, c.sessionId])).toEqual([
        [{ type: 'mouseMoved', x: 5, y: 6 }, undefined],
        [{ type: 'mousePressed', x: 5, y: 6, button: 'right', buttons: 2, clickCount: 1 }, undefined],
        [{ type: 'mouseReleased', x: 5, y: 6, button: 'right', buttons: 0, clickCount: 1 }, undefined],
      ])
    })

    it('mouse double clicks twice and down, up and move send one event', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await driver.run('mouse', { action: 'double', x: 1, y: 2 })
      expect(mouseEvents(cdp).map((c) => [c.params?.type, c.params?.clickCount])).toEqual([
        ['mouseMoved', undefined],
        ['mousePressed', 1],
        ['mouseReleased', 1],
        ['mousePressed', 2],
        ['mouseReleased', 2],
      ])
      cdp.calls.length = 0
      await driver.run('mouse', { action: 'down', x: 3, y: 4 })
      await driver.run('mouse', { action: 'move', x: 7, y: 8 })
      await driver.run('mouse', { action: 'up', x: 7, y: 8 })
      expect(mouseEvents(cdp).map((c) => c.params)).toEqual([
        { type: 'mousePressed', x: 3, y: 4, button: 'left', buttons: 1, clickCount: 1 },
        { type: 'mouseMoved', x: 7, y: 8, button: 'left', buttons: 1 },
        { type: 'mouseReleased', x: 7, y: 8, button: 'left', buttons: 0, clickCount: 1 },
      ])
      cdp.calls.length = 0
      await driver.run('mouse', { action: 'move', x: 9, y: 9 })
      expect(mouseEvents(cdp).map((c) => c.params)).toEqual([{ type: 'mouseMoved', x: 9, y: 9 }])
    })

    it('mouse move reports the held button between down and up', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await driver.run('mouse', { action: 'down', x: 1, y: 1, button: 'right' })
      await driver.run('mouse', { action: 'move', x: 2, y: 2 })
      await driver.run('mouse', { action: 'up', x: 2, y: 2, button: 'right' })
      await driver.run('mouse', { action: 'move', x: 3, y: 3 })
      expect(mouseEvents(cdp).map((c) => c.params)).toEqual([
        { type: 'mousePressed', x: 1, y: 1, button: 'right', buttons: 2, clickCount: 1 },
        { type: 'mouseMoved', x: 2, y: 2, button: 'right', buttons: 2 },
        { type: 'mouseReleased', x: 2, y: 2, button: 'right', buttons: 0, clickCount: 1 },
        { type: 'mouseMoved', x: 3, y: 3 },
      ])
    })

    it('mouse move reports a remaining held button after another is released', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await driver.run('mouse', { action: 'down', x: 1, y: 1, button: 'left' })
      await driver.run('mouse', { action: 'down', x: 1, y: 1, button: 'right' })
      await driver.run('mouse', { action: 'up', x: 1, y: 1, button: 'right' })
      await driver.run('mouse', { action: 'move', x: 2, y: 2 })
      await driver.run('mouse', { action: 'click', x: 2, y: 2, button: 'right' })
      expect(mouseEvents(cdp).map((c) => c.params)).toEqual([
        { type: 'mousePressed', x: 1, y: 1, button: 'left', buttons: 1, clickCount: 1 },
        { type: 'mousePressed', x: 1, y: 1, button: 'right', buttons: 3, clickCount: 1 },
        { type: 'mouseReleased', x: 1, y: 1, button: 'right', buttons: 1, clickCount: 1 },
        { type: 'mouseMoved', x: 2, y: 2, button: 'left', buttons: 1 },
        { type: 'mouseMoved', x: 2, y: 2, button: 'left', buttons: 1 },
        { type: 'mousePressed', x: 2, y: 2, button: 'right', buttons: 3, clickCount: 1 },
        { type: 'mouseReleased', x: 2, y: 2, button: 'right', buttons: 1, clickCount: 1 },
      ])
    })

    it('wheel sends deltas', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await driver.run('mouse', { action: 'wheel', x: 10, y: 20, deltaX: 3, deltaY: -40 })
      expect(mouseEvents(cdp).map((c) => c.params)).toEqual([{ type: 'mouseWheel', x: 10, y: 20, deltaX: 3, deltaY: -40 }])
      cdp.calls.length = 0
      await driver.run('mouse', { action: 'wheel', x: 10, y: 20 })
      expect(mouseEvents(cdp)[0]?.params).toMatchObject({ deltaX: 0, deltaY: 0 })
    })

    it('mouse rejects an unknown action', async () => {
      const { driver } = setup()
      await driver.start()
      await expect(driver.run('mouse', { action: 'nudge', x: 1, y: 1 })).rejects.toThrow('Unsupported mouse action: nudge')
    })

    it('drag interpolates moves and drops intercepted data', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await driver.run('snapshot', {})
      const before = cdp.listenerCount('Input.dragIntercepted')
      const data = { items: [{ mimeType: 'text/plain', data: 'hi' }], dragOperationsMask: 1 }
      // Chrome reports the drag while the pointer moves with the button held.
      cdp.handlers.set('Input.dispatchMouseEvent', (p) => {
        if (p?.type === 'mouseMoved' && p.buttons === 1) cdp.emit('Input.dragIntercepted', { data }, '')
        return {}
      })
      cdp.calls.length = 0
      const res = await driver.run('drag', { from: 'g1e2', to: { x: 120, y: 60 }, steps: 4 })
      expect(res).toEqual({ url: 'http://x/', title: 'T' })
      expect(cdp.listenerCount('Input.dragIntercepted')).toBe(before)
      // The ref centre is (20, 30); the target is (120, 60).
      const ordered = cdp.calls
        .filter((c) => c.method === 'Input.setInterceptDrags' || c.method === 'Input.dispatchMouseEvent' || c.method === 'Input.dispatchDragEvent')
        .map((c) => [c.method, c.params, c.sessionId])
      expect(ordered).toEqual([
        ['Input.setInterceptDrags', { enabled: true }, undefined],
        ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 30 }, undefined],
        ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 30, button: 'left', buttons: 1, clickCount: 1 }, undefined],
        ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 45, y: 37.5, button: 'left', buttons: 1 }, undefined],
        ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 70, y: 45, button: 'left', buttons: 1 }, undefined],
        ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 95, y: 52.5, button: 'left', buttons: 1 }, undefined],
        ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 60, button: 'left', buttons: 1 }, undefined],
        ['Input.dispatchDragEvent', { type: 'dragEnter', x: 120, y: 60, data }, undefined],
        ['Input.dispatchDragEvent', { type: 'dragOver', x: 120, y: 60, data }, undefined],
        ['Input.dispatchDragEvent', { type: 'drop', x: 120, y: 60, data }, undefined],
        ['Input.dispatchMouseEvent', { type: 'mouseReleased', x: 120, y: 60, button: 'left', buttons: 0, clickCount: 1 }, undefined],
        ['Input.setInterceptDrags', { enabled: false }, undefined],
      ])
    })

    it('drag without interception sends no drag events', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      await driver.run('drag', { from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, steps: 2 })
      expect(cdp.sent('Input.dispatchDragEvent')).toHaveLength(0)
      expect(mouseEvents(cdp).map((c) => c.params?.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseMoved', 'mouseMoved', 'mouseReleased'])
    })

    it('drag turns interception off when it fails', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Input.dispatchMouseEvent', (p) => {
        if (p?.type === 'mouseMoved' && p.x === 10) throw new Error('boom')
        return {}
      })
      await driver.start()
      const before = cdp.listenerCount('Input.dragIntercepted')
      await expect(driver.run('drag', { from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, steps: 1 })).rejects.toThrow('boom')
      const toggles = cdp.sent('Input.setInterceptDrags').map((c) => c.params)
      expect(toggles).toEqual([{ enabled: true }, { enabled: false }])
      expect(cdp.listenerCount('Input.dragIntercepted')).toBe(before)
    })

    it('drag from an iframe ref adds the frame owner offset', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Page.getFrameTree', (_p, sessionId) => ({
        frameTree: { frame: { id: 'main' }, childFrames: sessionId ? [] : [{ frame: { id: 'F1', url: 'http://frame/' } }] },
      }))
      cdp.handlers.set('Accessibility.getFullAXTree', (_p, sessionId) =>
        sessionId === 'S1'
          ? { nodes: [{ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'C' }, childIds: ['2'], backendDOMNodeId: 5 }, { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Inner' }, backendDOMNodeId: 77 }] }
          : tree,
      )
      cdp.handlers.set('DOM.getFrameOwner', () => ({ backendNodeId: 9 }))
      cdp.handlers.set('DOM.getBoxModel', ({ backendNodeId } = {}) => ({
        model: { content: backendNodeId === 9 ? [100, 200, 300, 200, 300, 300, 100, 300] : [10, 20, 30, 20, 30, 40, 10, 40] },
      }))
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await driver.run('snapshot', {})
      await driver.run('drag', { from: 'g1e4', to: { x: 0, y: 0 }, steps: 1 })
      expect(mouseEvents(cdp)[0]?.params).toEqual({ type: 'mouseMoved', x: 120, y: 230 })
      expect(mouseEvents(cdp)[0]?.sessionId).toBeUndefined()
    })

    it('emulate merges and null clears', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      await driver.start()
      cdp.calls.length = 0
      const first = (await driver.run('emulate', { userAgent: 'UA1', locale: 'de-DE', timezone: 'Europe/Berlin' })) as Dyn
      expect(first.emulation).toEqual({ userAgent: 'UA1', locale: 'de-DE', timezone: 'Europe/Berlin' })
      expect(first.url).toBe('http://x/')
      expect(cdp.sent('Emulation.').map((c) => [c.method, c.params, c.sessionId])).toEqual([
        ['Emulation.setUserAgentOverride', ua('UA1', { acceptLanguage: 'de-DE' }), undefined],
        ['Emulation.setGeolocationOverride', undefined, undefined],
        ['Emulation.setLocaleOverride', { locale: 'de-DE' }, undefined],
        ['Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' }, undefined],
      ])
      cdp.calls.length = 0
      const second = (await driver.run('emulate', { geolocation: { latitude: 1, longitude: 2 }, userAgent: null, locale: null })) as Dyn
      expect(second.emulation).toEqual({ geolocation: { latitude: 1, longitude: 2 }, timezone: 'Europe/Berlin' })
      expect(cdp.sent('Emulation.').map((c) => [c.method, c.params])).toEqual([
        ['Emulation.setUserAgentOverride', ua('DEFAULT-UA')],
        ['Emulation.setGeolocationOverride', { latitude: 1, longitude: 2, accuracy: 100 }],
        ['Emulation.setLocaleOverride', undefined],
        ['Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' }],
      ])
    })

    it('emulate reports a rejected value and keeps the earlier state', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      await driver.start()
      await driver.run('emulate', { locale: 'de-DE' })
      cdp.handlers.set('Emulation.setTimezoneOverride', (p) => {
        if (p?.timezoneId === 'Mars/Base') throw new Error('Invalid timezone id')
        return {}
      })
      cdp.calls.length = 0
      await expect(driver.run('emulate', { timezone: 'Mars/Base' })).rejects.toThrow('Emulation was rejected: Invalid timezone id')
      // The page went back to the previous state: the last four commands carry de-DE and no timezone.
      expect(cdp.sent('Emulation.').slice(-4).map((c) => [c.method, c.params, c.sessionId])).toEqual([
        ['Emulation.setUserAgentOverride', ua('DEFAULT-UA', { acceptLanguage: 'de-DE' }), undefined],
        ['Emulation.setGeolocationOverride', undefined, undefined],
        ['Emulation.setLocaleOverride', { locale: 'de-DE' }, undefined],
        ['Emulation.setTimezoneOverride', { timezoneId: '' }, undefined],
      ])
      const kept = (await driver.run('emulate', {})) as Dyn
      expect(kept.emulation).toEqual({ locale: 'de-DE' })
    })

    it('emulation is re-applied after start', async () => {
      const cdp = new FakeCdp()
      cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: ['http://x/', 'T'] } }))
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      const changes: Dyn[] = []
      const driver = new CdpDriver(cdp, {
        askOperator: async () => ({ accept: true }),
        emulation: { geolocation: { latitude: 3, longitude: 4, accuracy: 7 }, locale: 'fr-FR' },
        onEmulation: (s) => changes.push(s),
      })
      await driver.start()
      const methods = cdp.calls.map((c) => c.method)
      expect(methods.indexOf('Emulation.setLocaleOverride')).toBeGreaterThan(methods.indexOf('Page.enable'))
      expect(cdp.sent('Emulation.').map((c) => [c.method, c.params, c.sessionId])).toEqual([
        ['Emulation.setUserAgentOverride', ua('DEFAULT-UA', { acceptLanguage: 'fr-FR' }), undefined],
        ['Emulation.setGeolocationOverride', { latitude: 3, longitude: 4, accuracy: 7 }, undefined],
        ['Emulation.setLocaleOverride', { locale: 'fr-FR' }, undefined],
        ['Emulation.setTimezoneOverride', { timezoneId: '' }, undefined],
      ])
      expect(driver.emulation()).toEqual({ geolocation: { latitude: 3, longitude: 4, accuracy: 7 }, locale: 'fr-FR' })
      await driver.run('emulate', { locale: null })
      expect(changes).toEqual([
        { geolocation: { latitude: 3, longitude: 4, accuracy: 7 }, locale: 'fr-FR' },
        { geolocation: { latitude: 3, longitude: 4, accuracy: 7 } },
      ])
    })

    it('rewrite rules carried from a crashed page are intercepted on start and reported on change', async () => {
      const cdp = new FakeCdp()
      cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: ['http://x/', 'T'] } }))
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      const changes: unknown[] = []
      const driver = new CdpDriver(cdp, {
        askOperator: async () => ({ accept: true }),
        rules: [{ id: 'r2', urlPattern: 'http://x/*', setHeaders: { 'X-Test': '1' } }],
        onRules: (r) => changes.push(r),
      })
      await driver.start()
      expect(cdp.sent('Fetch.enable')[0]?.params).toEqual({ patterns: [{ urlPattern: 'http://x/*', requestStage: 'Request' }, ...HINT_PATTERNS] })
      const res = (await driver.run('rewrite', { rules: [{ urlPattern: 'http://y/*' }] })) as Dyn
      // New ids are numbered past the carried ones.
      expect(res.rules).toEqual([{ id: 'r3', urlPattern: 'http://y/*' }])
      expect(changes).toEqual([[{ id: 'r3', urlPattern: 'http://y/*' }]])
    })

    it('a failed re-apply at start drops the claimed emulation and reports it', async () => {
      const cdp = new FakeCdp()
      cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: ['http://x/', 'T'] } }))
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      let fail = true
      cdp.handlers.set('Emulation.setLocaleOverride', () => {
        if (fail) throw new Error('nope')
        return {}
      })
      const changes: Dyn[] = []
      const driver = new CdpDriver(cdp, {
        askOperator: async () => ({ accept: true }),
        emulation: { geolocation: { latitude: 3, longitude: 4 }, locale: 'fr-FR' },
        onEmulation: (s) => changes.push(s),
      })
      await driver.start()
      fail = false
      expect(driver.emulation()).toEqual({})
      expect(changes).toEqual([{}])
      expect(driver.log.since().entries.some((e) => e.text.includes('Emulation was not restored: nope'))).toBe(true)
    })

    it('an empty emulation at start does not notify', async () => {
      const { cdp } = setup()
      const changes: Dyn[] = []
      const withHook = new CdpDriver(cdp, { askOperator: async () => ({ accept: true }), onEmulation: (s) => changes.push(s) })
      await withHook.start()
      expect(changes).toEqual([])
      expect(withHook.emulation()).toEqual({})
    })

    it('an iframe attaching during emulate ends on the new state', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      await driver.start()
      await driver.run('emulate', { locale: 'de-DE' })
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => {
        release = r
      })
      cdp.handlers.set('Emulation.setLocaleOverride', (p, sessionId) => (sessionId === undefined && p?.locale === 'ja-JP' ? gate : {}))
      const pending = driver.run('emulate', { locale: 'ja-JP' })
      await vi.waitFor(() => expect(cdp.sent('Emulation.setLocaleOverride').some((c) => c.params?.locale === 'ja-JP')).toBe(true))
      attach(cdp, 'S1', 'F1')
      await vi.waitFor(() => expect(cdp.calls.some((c) => c.method === 'Network.enable' && c.sessionId === 'S1')).toBe(true))
      release()
      await pending
      await vi.waitFor(() => expect(cdp.sent('Emulation.setLocaleOverride').some((c) => c.sessionId === 'S1')).toBe(true))
      const inS1 = cdp.calls.filter((c) => c.sessionId === 'S1' && c.method === 'Emulation.setLocaleOverride').map((c) => c.params)
      expect(inS1.at(-1)).toEqual({ locale: 'ja-JP' })
      expect(driver.emulation()).toEqual({ locale: 'ja-JP' })
    })

    it('with nothing emulated, start applies the clean default user agent with its client hints', async () => {
      const { cdp, driver } = setup()
      const dirty =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) @exe/desktop/0.0.5 Chrome/146.0.7680.31 Electron/44.7.2 Safari/537.36'
      const clean = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.31 Safari/537.36'
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: dirty }))
      await driver.start()
      expect(cdp.sent('Emulation.setUserAgentOverride').map((c) => [c.params, c.sessionId])).toEqual([[ua(clean), undefined]])
      expect(cdp.sent('Emulation.setUserAgentOverride')[0]?.params?.userAgentMetadata).toMatchObject({
        brands: expect.arrayContaining([{ brand: 'Google Chrome', version: '146' }]),
      })
      expect(cdp.sent('Page.addScriptToEvaluateOnNewDocument')).toHaveLength(0)
      expect(driver.emulation()).toEqual({})
    })

    it('a default user agent given by the page wins over Browser.getVersion', async () => {
      const cdp = new FakeCdp()
      cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: ['http://x/', 'T'] } }))
      const driver = new CdpDriver(cdp, { askOperator: async () => ({ accept: true }), defaultUserAgent: 'PAGE-UA' })
      await driver.start()
      await driver.run('emulate', { userAgent: 'Custom' })
      await driver.run('emulate', { userAgent: null })
      expect(cdp.sent('Browser.getVersion')).toHaveLength(0)
      expect(cdp.sent('Emulation.setUserAgentOverride').map((c) => c.params)).toEqual([ua('PAGE-UA'), ua('Custom'), ua('PAGE-UA')])
    })

    it('explicit userAgentMetadata replaces the derived one and null clears it', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      await driver.start()
      const meta = { platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', model: '', mobile: false }
      const res = (await driver.run('emulate', { userAgent: 'UA1', userAgentMetadata: meta })) as Dyn
      expect(res.emulation).toEqual({ userAgent: 'UA1', userAgentMetadata: meta })
      expect(cdp.sent('Emulation.setUserAgentOverride').at(-1)?.params).toEqual({ userAgent: 'UA1', userAgentMetadata: meta })
      await driver.run('emulate', { userAgentMetadata: null })
      expect(cdp.sent('Emulation.setUserAgentOverride').at(-1)?.params).toEqual(ua('UA1'))
    })

    it('emulation applies to a new iframe session', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await driver.run('network', {})
      cdp.calls.length = 0
      await driver.run('emulate', { locale: 'ja-JP' })
      expect(cdp.sent('Emulation.setLocaleOverride').map((c) => c.sessionId)).toEqual([undefined, 'S1'])
      attach(cdp, 'S2', 'F2')
      await vi.waitFor(() => expect(cdp.sent('Emulation.setLocaleOverride').map((c) => c.sessionId)).toEqual([undefined, 'S1', 'S2']))
      const inS2 = cdp.calls.filter((c) => c.sessionId === 'S2' && c.method.startsWith('Emulation.')).map((c) => [c.method, c.params])
      expect(inS2).toEqual([
        ['Emulation.setUserAgentOverride', ua('DEFAULT-UA', { acceptLanguage: 'ja-JP' })],
        ['Emulation.setGeolocationOverride', undefined],
        ['Emulation.setLocaleOverride', { locale: 'ja-JP' }],
        ['Emulation.setTimezoneOverride', { timezoneId: '' }],
      ])
    })

    it('a failing iframe session does not break the root apply', async () => {
      const { cdp, driver } = setup()
      cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      cdp.handlers.set('Emulation.setLocaleOverride', (_p, sessionId) => {
        if (sessionId === 'S1') throw new Error('detached')
        return {}
      })
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await driver.run('network', {})
      cdp.calls.length = 0
      const res = (await driver.run('emulate', { locale: 'ja-JP' })) as Dyn
      expect(res.emulation).toEqual({ locale: 'ja-JP' })
      // A command the iframe refuses does not stop the ones after it.
      expect(cdp.sent('Emulation.setTimezoneOverride').map((c) => c.sessionId)).toEqual([undefined, 'S1'])
      expect(cdp.sent('Emulation.setLocaleOverride').map((c) => [c.params, c.sessionId])).toEqual([
        [{ locale: 'ja-JP' }, undefined],
        [{ locale: 'ja-JP' }, 'S1'],
      ])
    })
  })

  describe('wire headers', () => {
    it('the network log records the headers that went out on the wire', async () => {
      const { cdp, driver } = setup()
      await driver.start()
      // ExtraInfo may come first.
      cdp.emit('Network.requestWillBeSentExtraInfo', { requestId: 'N1', headers: { 'X-Exec-Test': 'yes', 'Accept-Language': 'en-US' } }, '')
      cdp.emit('Network.requestWillBeSent', { requestId: 'N1', request: { method: 'GET', url: 'http://x/a', headers: { 'X-Remove-Me': '1' } } }, '')
      cdp.emit('Network.responseReceivedExtraInfo', { requestId: 'N1', headers: { 'Set-Cookie': 'a=b' } }, '')
      const net = (await driver.run('network', {})) as { entries: Dyn[] }
      expect(net.entries[0]).toMatchObject({
        requestHeaders: { 'X-Remove-Me': '1' },
        sentHeaders: { 'X-Exec-Test': 'yes', 'Accept-Language': 'en-US' },
        receivedHeaders: { 'Set-Cookie': 'a=b' },
      })
    })
  })

  describe('geolocation shim', () => {
    const attach = (cdp: FakeCdp, sessionId: string, targetId: string) =>
      cdp.emit('Target.attachedToTarget', { sessionId, targetInfo: { targetId, type: 'iframe', url: 'http://frame/' } }, '')

    function geoSetup() {
      const s = setup()
      let n = 0
      s.cdp.handlers.set('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: `id${++n}` }))
      s.cdp.handlers.set('Browser.getVersion', () => ({ userAgent: 'DEFAULT-UA' }))
      return s
    }
    const scripts = (cdp: FakeCdp) =>
      cdp.calls
        .filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument' || c.method === 'Page.removeScriptToEvaluateOnNewDocument')
        .map((c) => [c.method.replace('Page.', '').replace('ScriptToEvaluateOnNewDocument', ''), c.params?.identifier ?? c.params?.source, c.sessionId])

    it('installs the shim in every session and evaluates it into the loaded documents', async () => {
      const { cdp, driver } = geoSetup()
      await driver.start()
      attach(cdp, 'S1', 'F1')
      await driver.run('network', {})
      cdp.calls.length = 0
      await driver.run('emulate', { geolocation: { latitude: 48.85, longitude: 2.35, accuracy: 10 } })
      const shim = geolocationShim({ latitude: 48.85, longitude: 2.35, accuracy: 10 })
      expect(scripts(cdp)).toEqual([
        ['add', shim, undefined],
        ['add', shim, 'S1'],
      ])
      expect(cdp.sent('Page.addScriptToEvaluateOnNewDocument').every((c) => c.params?.runImmediately === true)).toBe(true)
      const evals = cdp.sent('Runtime.evaluate').filter((c) => c.params?.expression === shim)
      expect(evals.map((c) => c.sessionId)).toEqual([undefined, 'S1'])
      // The CDP override is still sent next to the shim.
      expect(cdp.sent('Emulation.setGeolocationOverride')[0]?.params).toEqual({ latitude: 48.85, longitude: 2.35, accuracy: 10 })
    })

    it('a new position replaces the script, an unrelated change leaves it, and clearing restores', async () => {
      const { cdp, driver } = geoSetup()
      await driver.start()
      await driver.run('emulate', { geolocation: { latitude: 1, longitude: 2 } })
      await driver.run('emulate', { locale: 'de-DE' })
      expect(cdp.sent('Page.addScriptToEvaluateOnNewDocument')).toHaveLength(1)
      cdp.calls.length = 0
      await driver.run('emulate', { geolocation: { latitude: 3, longitude: 4 } })
      expect(scripts(cdp)).toEqual([
        ['remove', 'id1', undefined],
        ['add', geolocationShim({ latitude: 3, longitude: 4, accuracy: 100 }), undefined],
      ])
      cdp.calls.length = 0
      await driver.run('emulate', { geolocation: null })
      const restore = geolocationShim(null)
      expect(scripts(cdp)).toEqual([
        ['remove', 'id2', undefined],
        ['add', restore, undefined],
        ['remove', 'id3', undefined],
      ])
      expect(cdp.sent('Runtime.evaluate').some((c) => c.params?.expression === restore)).toBe(true)
      cdp.calls.length = 0
      await driver.run('emulate', { locale: null })
      expect(scripts(cdp)).toEqual([])
    })

    it('reaches iframe sessions attached later and is re-applied on start', async () => {
      const cdp = new FakeCdp()
      cdp.handlers.set('Runtime.evaluate', () => ({ result: { value: ['http://x/', 'T'] } }))
      cdp.handlers.set('Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: 'x' }))
      const driver = new CdpDriver(cdp, {
        askOperator: async () => ({ accept: true }),
        defaultUserAgent: 'UA',
        emulation: { geolocation: { latitude: 5, longitude: 6, accuracy: 7 } },
      })
      await driver.start()
      const shim = geolocationShim({ latitude: 5, longitude: 6, accuracy: 7 })
      expect(cdp.sent('Page.addScriptToEvaluateOnNewDocument').map((c) => [c.params?.source, c.sessionId])).toEqual([[shim, undefined]])
      attach(cdp, 'S2', 'F2')
      await vi.waitFor(() => expect(cdp.sent('Page.addScriptToEvaluateOnNewDocument').map((c) => c.sessionId)).toEqual([undefined, 'S2']))
    })

    it('a failing shim is logged and does not fail the emulation', async () => {
      const { cdp, driver } = geoSetup()
      cdp.handlers.set('Page.addScriptToEvaluateOnNewDocument', () => {
        throw new Error('nope')
      })
      await driver.start()
      const res = (await driver.run('emulate', { geolocation: { latitude: 1, longitude: 2 } })) as Dyn
      expect(res.emulation).toEqual({ geolocation: { latitude: 1, longitude: 2 } })
      expect(driver.log.since().entries.some((e) => e.text.includes('The geolocation script was not applied: nope'))).toBe(true)
    })
  })

  describe('eval in a frame', () => {
    // A data: page holding a cross-origin iframe: with site isolation the frame is its own target (S1),
    // without it the frame stays in the page's process (frame G1 of the root session).
    const page = (oop: boolean) => {
      const s = setup()
      s.cdp.handlers.set('Page.getFrameTree', (_p, sessionId) => ({
        frameTree: {
          frame: { id: sessionId ? 'F1' : 'main', url: sessionId ? 'https://other.test/' : 'data:text/html,x' },
          childFrames: sessionId ? [] : [{ frame: { id: oop ? 'F1' : 'G1', url: 'https://other.test/' } }],
        },
      }))
      s.cdp.handlers.set('Accessibility.getFullAXTree', () => tree)
      s.cdp.handlers.set('Page.createIsolatedWorld', () => ({ executionContextId: 99 }))
      // Each context answers with where it is, so the test sees which document ran the expression.
      s.cdp.handlers.set('Runtime.evaluate', (p, sessionId) => {
        if (String(p?.expression).startsWith('[location.href')) return { result: { value: ['data:text/html,x', 'T'] } }
        const where = sessionId === 'S1' ? 'oopif' : p?.contextId === 5 ? 'frame-main-world' : p?.contextId === 99 ? 'frame-isolated' : 'top'
        return { result: { value: where } }
      })
      return s
    }

    it('reaches an out-of-process frame through its session', async () => {
      const { cdp, driver } = page(true)
      await driver.start()
      cdp.emit('Target.attachedToTarget', { sessionId: 'S1', targetInfo: { targetId: 'F1', type: 'iframe', url: 'https://other.test/' } }, '')
      const snap = (await driver.run('snapshot', {})) as Dyn
      expect(snap.snapshot).toContain('- frame "https://other.test/" [frame=f1]')
      expect(await driver.run('eval', { expression: 'location.href', frame: 'f1' })).toEqual({ value: 'oopif' })
      expect(await driver.run('eval', { expression: 'location.href' })).toEqual({ value: 'top' })
    })

    it("reaches a same-process frame in its main world, so the frame's own globals are visible", async () => {
      const { cdp, driver } = page(false)
      await driver.start()
      cdp.emit('Runtime.executionContextCreated', { context: { id: 4, auxData: { frameId: 'main', isDefault: true } } }, '')
      cdp.emit('Runtime.executionContextCreated', { context: { id: 5, auxData: { frameId: 'G1', isDefault: true } } }, '')
      cdp.emit('Runtime.executionContextCreated', { context: { id: 6, auxData: { frameId: 'G1', isDefault: false } } }, '')
      await driver.run('snapshot', {})
      expect(await driver.run('eval', { expression: 'window.secret', frame: 'f1' })).toEqual({ value: 'frame-main-world' })
      expect(cdp.sent('Page.createIsolatedWorld')).toHaveLength(0)
    })

    it('falls back to an isolated world when the main world is unknown or gone', async () => {
      const { cdp, driver } = page(false)
      await driver.start()
      await driver.run('snapshot', {})
      expect(await driver.run('eval', { expression: 'document.title', frame: 'f1' })).toEqual({ value: 'frame-isolated' })
      expect(cdp.sent('Page.createIsolatedWorld')[0]?.params).toEqual({ frameId: 'G1' })

      cdp.emit('Runtime.executionContextCreated', { context: { id: 5, auxData: { frameId: 'G1', isDefault: true } } }, '')
      cdp.emit('Runtime.executionContextDestroyed', { executionContextId: 5 }, '')
      expect(await driver.run('eval', { expression: '1', frame: 'f1' })).toEqual({ value: 'frame-isolated' })

      cdp.emit('Runtime.executionContextCreated', { context: { id: 7, auxData: { frameId: 'G1', isDefault: true } } }, '')
      const plain = cdp.handlers.get('Runtime.evaluate')!
      cdp.handlers.set('Runtime.evaluate', (p, sessionId) => {
        if (p?.contextId === 7) throw new Error('Cannot find context with specified id')
        return plain(p, sessionId)
      })
      expect(await driver.run('eval', { expression: '2', frame: 'f1' })).toEqual({ value: 'frame-isolated' })
    })
  })
})
