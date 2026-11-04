import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import { findChromeBinary } from '../helpers.js'

/** What a screenshot needs: a url, the headers to add to every request it makes,
 *  whether to capture the full page, and a hard time budget. */
export interface ScreenshotRequest {
  url: string
  headers: Record<string, string>
  fullPage: boolean
  timeoutMs: number
}

/** Captures `req.url` and returns the PNG bytes, or throws with a reason the
 *  node can surface. Injectable so tests drive the node without a real browser. */
export type ScreenshotDriver = (req: ScreenshotRequest) => Promise<Buffer>

/** True when the engine runs as root, where Chrome will not start sandboxed. */
function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0
}

/**
 * The header list for `Fetch.continueRequest`. The request's own copy of any
 * header we are setting is dropped first, so our value replaces it rather than
 * the browser sending the header twice (mirrors the reference CDP screenshot
 * node). Everything the browser already put on the request is kept.
 */
export function mergeFetchHeaders(
  requestHeaders: Record<string, unknown>,
  extra: Record<string, string>,
): Array<{ name: string; value: string }> {
  const overridden = new Set(Object.keys(extra).map((k) => k.toLowerCase()))
  const out: Array<{ name: string; value: string }> = []
  for (const [name, value] of Object.entries(requestHeaders)) {
    if (!overridden.has(name.toLowerCase())) out.push({ name, value: String(value) })
  }
  for (const [name, value] of Object.entries(extra)) out.push({ name, value })
  return out
}

/**
 * Whether a request the page makes may carry the node's headers. Only requests
 * to the target's own host do: the headers are usually credentials for the
 * target, and a page also loads CDNs, analytics and other third parties that
 * must never see them. Any scheme or port on that host counts, so an http to
 * https redirect keeps them.
 */
export function sendsHeadersTo(requestUrl: string, targetUrl: string): boolean {
  try {
    return new URL(requestUrl).hostname.toLowerCase() === new URL(targetUrl).hostname.toLowerCase()
  } catch {
    return false
  }
}

/** Rejects with a timeout error once `deadline` passes, unless `work` settles first. */
async function beforeDeadline<T>(work: Promise<T>, deadline: number, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`screenshot timed out after ${String(timeoutMs)}ms`)),
      Math.max(0, deadline - Date.now()),
    )
  })
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}

/** A minimal CDP client over a DevTools WebSocket: request/response by id, plus
 *  event subscriptions. Just enough to drive one screenshot. */
class CdpSession {
  private nextId = 0
  private readonly pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>()
  private readonly listeners = new Map<string, (params: Record<string, unknown>) => void>()

  constructor(private readonly ws: WebSocket) {
    // A browser that dies mid-capture closes the socket; fail whatever was
    // waiting on it rather than leaving the node hanging.
    // Errors surface as a close; without a listener one would crash the engine.
    ws.on('error', () => {})
    ws.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('Chrome closed the DevTools connection'))
      this.pending.clear()
    })
    ws.on('message', (data: WebSocket.RawData) => {
      let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string } }
      try {
        msg = JSON.parse(String(data)) as typeof msg
      } catch {
        return
      }
      if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id)
        if (p === undefined) return
        this.pending.delete(msg.id)
        if (msg.error !== undefined) p.reject(new Error(msg.error.message ?? 'CDP error'))
        else p.resolve(msg.result ?? {})
      } else if (typeof msg.method === 'string') {
        this.listeners.get(msg.method)?.(msg.params ?? {})
      }
    })
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = (this.nextId += 1)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Fire-and-forget: a continueRequest for a request the page already dropped
   *  would reject, and that is not worth failing the capture over. */
  fire(method: string, params: Record<string, unknown> = {}): void {
    const id = (this.nextId += 1)
    this.ws.send(JSON.stringify({ id, method, params }))
  }

  on(method: string, fn: (params: Record<string, unknown>) => void): void {
    this.listeners.set(method, fn)
  }
}

/** Wait for the DevTools port Chrome writes into its profile, or throw. */
function readDevToolsPort(profileDir: string, deadline: number): Promise<number> {
  const portFile = join(profileDir, 'DevToolsActivePort')
  return (async () => {
    while (Date.now() < deadline) {
      try {
        const line = readFileSync(portFile, 'utf8').split('\n')[0]?.trim()
        if (line !== undefined && line !== '') return Number(line)
      } catch {
        /* not written yet */
      }
      await delay(100)
    }
    throw new Error('Chrome did not expose a DevTools port in time')
  })()
}

/**
 * Drive the system Chrome over CDP to screenshot a url with extra request
 * headers. Unlike `chrome --screenshot`, the page's requests to the target host
 * can carry the engagement's headers (Fetch.enable → continueRequest), and a
 * full-page capture uses captureBeyondViewport. The whole capture is bounded by
 * the node's timeout, and the browser runs in a throwaway profile that is always
 * killed and cleaned up.
 */
export const cdpScreenshot: ScreenshotDriver = async (req) => {
  const chrome = findChromeBinary()
  if (chrome === null) throw new Error('no Chrome/Chromium binary found (install Google Chrome or chromium)')

  const profileDir = mkdtempSync(join(tmpdir(), 'exe-shot-'))
  const args = [
    '--headless=new',
    '--disable-gpu',
    // Chrome's sandbox stays on except as root (a container), where it refuses
    // to start sandboxed. Same rule the old --screenshot path used.
    ...(isRoot() ? ['--no-sandbox'] : []),
    '--hide-scrollbars',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,800',
    'about:blank',
  ]
  const child = spawn(chrome, args, { stdio: 'ignore' })
  let ws: WebSocket | undefined
  const deadline = Date.now() + req.timeoutMs
  // Chrome exiting early (a bad flag, a crash) fails the capture at once
  // instead of waiting out the deadline for a port that will never appear.
  const exited = new Promise<never>((_, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Chrome exited before the screenshot (code ${String(code)})`)))
  })
  exited.catch(() => {})
  // The whole capture, not only the page load, answers to the node's time
  // budget: a hung navigation or capture call must not hold the run forever.
  const capture = async (): Promise<Buffer> => {
    const port = await readDevToolsPort(profileDir, deadline)
    const list = (await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()) as Array<{
      type?: string
      webSocketDebuggerUrl?: string
    }>
    const page = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
    if (page?.webSocketDebuggerUrl === undefined) throw new Error('Chrome exposed no page target to drive')

    ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
    await new Promise<void>((resolve, reject) => {
      ws!.once('open', resolve)
      ws!.once('error', reject)
    })
    const cdp = new CdpSession(ws)

    await cdp.send('Page.enable')
    // Add the headers to the target's own requests before the page navigates.
    // Without headers nothing needs intercepting, so the page loads untouched.
    if (Object.keys(req.headers).length > 0) {
      cdp.on('Fetch.requestPaused', (params) => {
        const request = params.request as { url?: string; headers?: Record<string, unknown> } | undefined
        cdp.fire(
          'Fetch.continueRequest',
          sendsHeadersTo(request?.url ?? '', req.url)
            ? { requestId: params.requestId, headers: mergeFetchHeaders(request?.headers ?? {}, req.headers) }
            : { requestId: params.requestId },
        )
      })
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
    }

    const loaded = new Promise<void>((resolve) => cdp.on('Page.loadEventFired', () => resolve()))
    const nav = (await cdp.send('Page.navigate', { url: req.url })) as { errorText?: string }
    if (typeof nav.errorText === 'string' && nav.errorText !== '') throw new Error(`navigation failed: ${nav.errorText}`)

    // Give the page until shortly before the time budget to fire load, then
    // settle briefly so late paints land. The rest of the budget is kept for the
    // capture itself, so a page that never fires load still gets captured.
    const loadDeadline = deadline - Math.min(5000, req.timeoutMs / 4)
    await Promise.race([loaded, delay(Math.max(0, loadDeadline - Date.now()))])
    await delay(Math.min(500, Math.max(0, loadDeadline - Date.now())))

    const shot: Record<string, unknown> = { format: 'png' }
    if (req.fullPage) {
      const metrics = (await cdp.send('Page.getLayoutMetrics')) as {
        cssContentSize?: { width: number; height: number }
        contentSize?: { width: number; height: number }
      }
      const size = metrics.cssContentSize ?? metrics.contentSize
      if (size !== undefined) {
        shot.captureBeyondViewport = true
        shot.clip = { x: 0, y: 0, width: Math.min(size.width, 1920), height: Math.min(size.height, 8000), scale: 1 }
      }
    }
    const result = (await cdp.send('Page.captureScreenshot', shot)) as { data?: string }
    if (typeof result.data !== 'string') throw new Error('Chrome returned no screenshot data')
    return Buffer.from(result.data, 'base64')
  }
  try {
    return await beforeDeadline(Promise.race([capture(), exited]), deadline, req.timeoutMs)
  } finally {
    ws?.close()
    child.kill('SIGKILL')
    if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true })
  }
}
