import { afterEach, describe, expect, it, vi } from 'vitest'
import { STALE_REF } from '@exe/protocol'
import { CdpDriver, type Cdp, type Dyn } from './cdp-driver'

type Handler = (params?: Record<string, unknown>) => Dyn

class FakeCdp implements Cdp {
  calls: { method: string; params?: Record<string, unknown> | undefined }[] = []
  handlers = new Map<string, Handler>()
  private listeners = new Map<string, Set<(p: Dyn) => void>>()

  async send(method: string, params?: Record<string, unknown>): Promise<Dyn> {
    this.calls.push({ method, params })
    const h = this.handlers.get(method)
    return h ? h(params) : {}
  }
  on(event: string, cb: (p: Dyn) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb)
    this.listeners.set(event, set)
    return () => set.delete(cb)
  }
  emit(event: string, params: Dyn): void {
    for (const cb of this.listeners.get(event) ?? []) cb(params)
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
})
