import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { connectCdp, type Cdp } from './cdp.js'
import { resolveChromePath } from './chrome-path.js'

export interface LaunchedChrome {
  cdp: Cdp
  kill: () => Promise<void>
}

export type ChromeLauncher = (opts: {
  platform: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}) => Promise<LaunchedChrome>

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        server.close()
        reject(new Error('could not bind debug port'))
        return
      }
      const { port } = addr
      server.close((err) => (err !== undefined && err !== null ? reject(err) : resolve(port)))
    })
    server.on('error', reject)
  })
}

async function waitForDebugger(port: number, timeoutMs: number): Promise<{ wsUrl: string }> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(500),
      })
      if (res.ok) {
        const body = (await res.json()) as { webSocketDebuggerUrl?: string }
        if (typeof body.webSocketDebuggerUrl === 'string') {
          return { wsUrl: body.webSocketDebuggerUrl }
        }
      }
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(
    `Chromium debug endpoint did not become ready: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

/** Launch one Chromium process with a browser-level CDP websocket. */
export const launchChrome: ChromeLauncher = async ({ platform, env = process.env }) => {
  const binary = resolveChromePath(platform, env)
  if (binary === null) {
    throw new Error('No Chromium-based browser found (set EXE_CHROME_PATH or install Google Chrome)')
  }
  const port = await freePort()
  const userDataDir = await mkdtemp(join(tmpdir(), 'exe-host-browser-'))
  const child: ChildProcess = spawn(
    binary,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      'about:blank',
    ],
    { stdio: 'ignore', env, detached: false },
  )

  let killed = false
  const kill = async (): Promise<void> => {
    if (killed) return
    killed = true
    if (child.pid !== undefined && !child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve()
      }, 2000)
      child.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
  }

  child.on('error', () => {
    void kill()
  })

  try {
    const { wsUrl } = await waitForDebugger(port, 15_000)
    const cdp = await connectCdp(wsUrl)
    return { cdp, kill }
  } catch (err) {
    await kill()
    throw err
  }
}
