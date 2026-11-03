import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { EngineSupervisor, type EngineConnection } from '@exe/engine-supervisor'
import { globalLayout } from '@exe/protocol'
import { checkAgents } from './agents.js'
import {
  BROWSER_DARWIN_REQUIRED,
  HostBrowserManager,
  type Bounds,
  type BrowserStateEvent,
  type OperatorOp,
} from './browser/index.js'
import { collectConnectionHints } from './connection-hints.js'
import { backendTestArgs, runEngineJson, sshEnrollArgs } from './engine-cli.js'
import {
  encodeImageToPngDataUrl,
  hasPhoto,
  isEngagementRoot,
  photoPath,
  removePhoto,
  writePhoto,
} from './engagement-photo.js'
import { DARWIN_REQUIRED, chooseFolder, chooseImage, type OsascriptRunner } from './mac-dialogs.js'
import { portablePublicDir, resolveEnginePath } from './paths.js'

export interface HostServeOptions {
  host: string
  port: number
  /** When set, use this bootstrap token instead of generating one. */
  bootstrapToken?: string
  enginePath?: string
  nodeBin?: string
  /** Injectable osascript runner for cancelled-dialog harnesses and unit tests. */
  runOsascript?: OsascriptRunner
  platform?: NodeJS.Platform
  /** Injectable host browser manager (tests / fake CDP). */
  browsers?: HostBrowserManager
}

export interface HostServer {
  readonly bootstrapToken: string
  readonly url: string
  /** Stops engines and closes the HTTP server. Await before rebinding the same port. */
  stop(): Promise<void>
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function tokensEqual(a: string, b: string): boolean {
  const da = digest(a)
  const db = digest(b)
  return da.length === db.length && timingSafeEqual(da, db)
}

function bearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m?.[1]
}

function runInit(
  nodeBin: string,
  enginePath: string,
  dir: string,
  name: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [enginePath, 'init', dir, '--name', name], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`init failed (${code})`))))
    child.on('error', reject)
  })
}

function dialogFailure(err: unknown): { status: 501 | 500; body: { error: string } } {
  const message = err instanceof Error ? err.message : String(err)
  if (message === DARWIN_REQUIRED) return { status: 501, body: { error: DARWIN_REQUIRED } }
  return { status: 500, body: { error: message } }
}

function browserFailure(err: unknown): { status: 501 | 500; body: { error: string } } {
  const message = err instanceof Error ? err.message : String(err)
  if (message === BROWSER_DARWIN_REQUIRED) return { status: 501, body: { error: BROWSER_DARWIN_REQUIRED } }
  return { status: 500, body: { error: message } }
}

function parseOperatorOp(raw: unknown): OperatorOp | null {
  if (raw === 'back' || raw === 'forward' || raw === 'reload' || raw === 'stop') return raw
  if (raw !== null && typeof raw === 'object' && 'navigate' in raw) {
    const navigate = (raw as { navigate: unknown }).navigate
    if (typeof navigate === 'string' && navigate !== '') return { navigate }
  }
  return null
}

function parseBounds(raw: unknown): Bounds | null | undefined {
  if (raw === null) return null
  if (raw === undefined || typeof raw !== 'object') return undefined
  const b = raw as Record<string, unknown>
  if (
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number'
  ) {
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  }
  return undefined
}

/**
 * Team server: Host RPC + portable static UI. Owns EngineSupervisor.
 * Localhost v1 returns the engine master token (same grade as today's
 * Electron renderer). Client-scoped minting lands before non-loopback bind.
 */
export async function startHost(options: HostServeOptions): Promise<HostServer> {
  const enginePath = options.enginePath ?? resolveEnginePath()
  const nodeBin = options.nodeBin ?? process.env.npm_node_execpath ?? 'node'
  const bootstrapToken = options.bootstrapToken ?? randomBytes(32).toString('base64url')
  const platform = options.platform ?? process.platform
  const dialogOpts = {
    platform,
    ...(options.runOsascript !== undefined ? { runOsascript: options.runOsascript } : {}),
  }

  const supervisor = new EngineSupervisor({
    enginePath,
    nodeBin,
    spawnEnv: process.env,
  })
  const browsers =
    options.browsers ??
    new HostBrowserManager({
      platform,
      env: process.env,
    })

  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, role: 'executioner-host' }))

  app.use('/host/*', async (c, next) => {
    const token = bearer(c.req.header('authorization')) ?? c.req.query('token')
    if (token === undefined || token === '' || !tokensEqual(token, bootstrapToken)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  })

  app.get('/host/agents', async (c) => {
    const agents = await checkAgents()
    return c.json({ agents })
  })

  app.get('/host/engagements', (c) => {
    return c.json({
      dirs: supervisor.served(),
      connections: supervisor.served().map((dir) => {
        const conn = supervisor.current(dir)
        return conn === undefined ? { dir } : { dir, ...conn }
      }),
    })
  })

  app.post('/host/engagements/open', async (c) => {
    const body = (await c.req.json()) as {
      dir?: string
      create?: boolean
      name?: string
    }
    const dir = body.dir
    if (typeof dir !== 'string' || dir === '') {
      return c.json({ error: 'dir required' }, 400)
    }
    if (body.create === true) {
      const name = typeof body.name === 'string' && body.name !== '' ? body.name : 'Engagement'
      await runInit(nodeBin, enginePath, dir, name)
    }
    try {
      const connection: EngineConnection = await supervisor.start(dir)
      return c.json({
        port: connection.port,
        token: connection.token,
        projectRoot: connection.projectRoot,
        endpoint: { host: '127.0.0.1', port: connection.port },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.post('/host/engagements/close', async (c) => {
    const body = (await c.req.json()) as { dir?: string }
    const dir = body.dir
    if (typeof dir !== 'string' || dir === '') {
      return c.json({ error: 'dir required' }, 400)
    }
    browsers.closeRoot(dir)
    supervisor.stop(dir)
    return c.json({ ok: true })
  })

  app.post('/host/browser/place', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      root?: unknown
      id?: unknown
      bounds?: unknown
    }
    if (typeof body.root !== 'string' || body.root === '' || typeof body.id !== 'string' || body.id === '') {
      return c.json({ error: 'root and id required' }, 400)
    }
    const bounds = parseBounds(body.bounds)
    if (bounds === undefined && body.bounds !== undefined) {
      return c.json({ error: 'bounds must be null or { x, y, width, height }' }, 400)
    }
    try {
      browsers.place(body.root, body.id, bounds ?? null)
      return c.json({ ok: true })
    } catch (err) {
      const fail = browserFailure(err)
      return c.json(fail.body, fail.status)
    }
  })

  app.post('/host/browser/occluded', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { occluded?: unknown }
    if (typeof body.occluded !== 'boolean') {
      return c.json({ error: 'occluded boolean required' }, 400)
    }
    try {
      browsers.setOccluded(body.occluded)
      return c.json({ ok: true })
    } catch (err) {
      const fail = browserFailure(err)
      return c.json(fail.body, fail.status)
    }
  })

  app.post('/host/browser/operator', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      root?: unknown
      id?: unknown
      op?: unknown
    }
    if (typeof body.root !== 'string' || body.root === '' || typeof body.id !== 'string' || body.id === '') {
      return c.json({ error: 'root and id required' }, 400)
    }
    const op = parseOperatorOp(body.op)
    if (op === null) {
      return c.json({ error: 'op required' }, 400)
    }
    try {
      await browsers.operator(body.root, body.id, op)
      return c.json({ ok: true })
    } catch (err) {
      const fail = browserFailure(err)
      return c.json(fail.body, fail.status)
    }
  })

  app.post('/host/browser/close', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { root?: unknown; id?: unknown }
    if (typeof body.root !== 'string' || body.root === '' || typeof body.id !== 'string' || body.id === '') {
      return c.json({ error: 'root and id required' }, 400)
    }
    try {
      browsers.close(body.root, body.id)
      return c.json({ ok: true })
    } catch (err) {
      const fail = browserFailure(err)
      return c.json(fail.body, fail.status)
    }
  })

  app.get('/host/browser/events', (c) => {
    return streamSSE(c, async (stream) => {
      let alive = true
      const unsub = browsers.subscribe((e: BrowserStateEvent) => {
        if (!alive) return
        void stream.writeSSE({ data: JSON.stringify(e) })
      })
      stream.onAbort(() => {
        alive = false
        unsub()
      })
      while (alive) {
        await stream.sleep(20_000)
        if (!alive) break
        await stream.writeSSE({ event: 'ping', data: '1' })
      }
      unsub()
    })
  })

  app.post('/host/dialogs/folder', async (c) => {
    try {
      const path = await chooseFolder(dialogOpts)
      return c.json({ path })
    } catch (err) {
      const fail = dialogFailure(err)
      return c.json(fail.body, fail.status)
    }
  })

  app.get('/host/connection-hints', async (c) => {
    const hints = await collectConnectionHints()
    return c.json(hints)
  })

  app.post('/host/engagement-photo/pick', async (c) => {
    try {
      const source = await chooseImage(dialogOpts)
      if (source === null) return c.json({ dataUrl: null })
      const dataUrl = await encodeImageToPngDataUrl(source)
      return c.json({ dataUrl })
    } catch (err) {
      const fail = dialogFailure(err)
      return c.json(fail.body, fail.status)
    }
  })

  app.post('/host/engagement-photo/read', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { root?: unknown }
    if (!isEngagementRoot(body.root)) return c.json({ dataUrl: null })
    if (!hasPhoto(body.root)) return c.json({ dataUrl: null })
    const dataUrl = await encodeImageToPngDataUrl(photoPath(body.root))
    return c.json({ dataUrl })
  })

  app.post('/host/engagement-photo/write', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { root?: unknown; dataUrl?: unknown }
    if (!isEngagementRoot(body.root) || typeof body.dataUrl !== 'string') {
      return c.json({ dataUrl: null })
    }
    if (!writePhoto(body.root, body.dataUrl)) return c.json({ dataUrl: null })
    const dataUrl = await encodeImageToPngDataUrl(photoPath(body.root))
    return c.json({ dataUrl })
  })

  app.post('/host/engagement-photo/clear', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { root?: unknown }
    if (isEngagementRoot(body.root)) removePhoto(body.root)
    return c.json({ ok: true })
  })

  app.post('/host/ssh/enroll', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      host?: unknown
      user?: unknown
      password?: unknown
      port?: unknown
    } | null
    if (body === null || typeof body !== 'object') {
      return c.json({ error: 'host, user and password are required' }, 400)
    }
    const host = typeof body.host === 'string' ? body.host.trim() : ''
    const user = typeof body.user === 'string' ? body.user.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (host === '' || user === '' || password === '') {
      return c.json({ error: 'host, user and password are required' }, 400)
    }
    const port =
      typeof body.port === 'number' && Number.isFinite(body.port) ? body.port : undefined
    try {
      const result = await runEngineJson({
        nodeBin,
        enginePath,
        args: sshEnrollArgs(globalLayout.sshKeys()),
        input: { host, user, password, ...(port !== undefined ? { port } : {}) },
      })
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.post('/host/backends/test', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      profile?: unknown
      createWorkdir?: unknown
    }
    if (body.profile === undefined || body.profile === null || typeof body.profile !== 'object') {
      return c.json({ error: 'profile required' }, 400)
    }
    try {
      const result = await runEngineJson({
        nodeBin,
        enginePath,
        args: backendTestArgs(body.createWorkdir === true),
        input: body.profile,
      })
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  const publicRoot = portablePublicDir()
  app.use('/*', serveStatic({ root: publicRoot }))
  app.get('/', serveStatic({ path: join(publicRoot, 'index.html') }))

  const server = serve({ fetch: app.fetch, hostname: options.host, port: options.port })

  const url = `http://${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${options.port}`

  return {
    bootstrapToken,
    url,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        void browsers.closeAll().finally(() => {
          supervisor.stopAll()
          server.close((err) => {
            if (err !== undefined && err !== null) reject(err)
            else resolve()
          })
        })
      }),
  }
}
