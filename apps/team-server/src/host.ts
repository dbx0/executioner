import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { EngineSupervisor, type EngineConnection } from '@exe/engine-supervisor'
import { checkAgents } from './agents.js'
import { collectConnectionHints } from './connection-hints.js'
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
}

export interface HostServer {
  readonly bootstrapToken: string
  readonly url: string
  stop(): void
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

/**
 * Team server: Host RPC + portable static UI. Owns EngineSupervisor.
 * Localhost v1 returns the engine master token (same grade as today's
 * Electron renderer). Client-scoped minting lands before non-loopback bind.
 */
export async function startHost(options: HostServeOptions): Promise<HostServer> {
  const enginePath = options.enginePath ?? resolveEnginePath()
  const nodeBin = options.nodeBin ?? process.env.npm_node_execpath ?? 'node'
  const bootstrapToken = options.bootstrapToken ?? randomBytes(32).toString('base64url')
  const dialogOpts = {
    platform: options.platform ?? process.platform,
    ...(options.runOsascript !== undefined ? { runOsascript: options.runOsascript } : {}),
  }

  const supervisor = new EngineSupervisor({
    enginePath,
    nodeBin,
    spawnEnv: process.env,
  })

  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, role: 'executioner-host' }))

  app.use('/host/*', async (c, next) => {
    const token = bearer(c.req.header('authorization'))
    if (token === undefined || !tokensEqual(token, bootstrapToken)) {
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
    const connection: EngineConnection = await supervisor.start(dir)
    return c.json({
      port: connection.port,
      token: connection.token,
      projectRoot: connection.projectRoot,
      endpoint: { host: '127.0.0.1', port: connection.port },
    })
  })

  app.post('/host/engagements/close', async (c) => {
    const body = (await c.req.json()) as { dir?: string }
    const dir = body.dir
    if (typeof dir !== 'string' || dir === '') {
      return c.json({ error: 'dir required' }, 400)
    }
    supervisor.stop(dir)
    return c.json({ ok: true })
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

  const publicRoot = portablePublicDir()
  app.use('/*', serveStatic({ root: publicRoot }))
  app.get('/', serveStatic({ path: join(publicRoot, 'index.html') }))

  const server = serve({ fetch: app.fetch, hostname: options.host, port: options.port })

  const url = `http://${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${options.port}`

  return {
    bootstrapToken,
    url,
    stop: () => {
      supervisor.stopAll()
      server.close()
    },
  }
}
