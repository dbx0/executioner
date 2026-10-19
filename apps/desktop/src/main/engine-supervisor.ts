import { spawn, type ChildProcess } from 'node:child_process'
import { parseHandshake, type Handshake } from '@exe/protocol'

export interface EngineConnection {
  port: number
  token: string
  projectRoot: string
}

type SpawnFn = (command: string, args: string[], options: object) => ChildProcess
type FetchFn = (input: string) => Promise<{ ok: boolean }>

export interface SupervisorOptions {
  enginePath: string
  /** Node binary used to run the engine. Under Electron this must be system
   * Node, not the Electron binary, so the engine's native deps match ABIs. */
  nodeBin?: string
  /** Environment for the engine child process. In a packaged app this carries
   * ELECTRON_RUN_AS_NODE=1 so the Electron binary runs the engine as plain Node
   * (matching the Electron-ABI-rebuilt natives). Defaults to process.env. */
  spawnEnv?: NodeJS.ProcessEnv
  spawnFn?: SpawnFn
  fetchFn?: FetchFn
}

/** A live engine: the child process and the connection that reaches it. */
interface Engine {
  child: ChildProcess
  connection: EngineConnection
}

/**
 * Owns one engine child process **per project**. Spawns `serve <dir>`, waits
 * for the handshake line on stdout, confirms readiness with a /health probe,
 * and can stop one project's engine or all of them.
 *
 * One engine per project rather than one overall, because the app keeps several
 * engagements open at once and each tab holds its own port + token. A single
 * shared child meant opening a second engagement killed the first one's engine
 * — and with it every tool process its in-flight runs had spawned — while that
 * tab went on pointing at a dead port.
 *
 * spawnFn and fetchFn are injectable so the handshake logic is testable without
 * a real process or Electron.
 */
export class EngineSupervisor {
  /** Live engines keyed by the project dir they serve. */
  private readonly engines = new Map<string, Engine>()
  /** In-flight starts, so two opens of one project share a single engine. */
  private readonly starting = new Map<string, Promise<EngineConnection>>()
  private readonly enginePath: string
  private readonly nodeBin: string
  private readonly spawnEnv: NodeJS.ProcessEnv
  private readonly spawnFn: SpawnFn
  private readonly fetchFn: FetchFn

  constructor(options: SupervisorOptions) {
    this.enginePath = options.enginePath
    this.nodeBin = options.nodeBin ?? process.execPath
    this.spawnEnv = options.spawnEnv ?? process.env
    this.spawnFn = options.spawnFn ?? (spawn as unknown as SpawnFn)
    this.fetchFn = options.fetchFn ?? ((url) => fetch(url).then((r) => ({ ok: r.ok })))
  }

  /**
   * The live connection when this project is already being served, else
   * undefined. Callers use it to avoid tearing down an engine that is mid-run:
   * stopping it kills every tool process the run had spawned.
   */
  current(projectDir: string): EngineConnection | undefined {
    const engine = this.engines.get(projectDir)
    if (engine === undefined) return undefined
    // A child that already exited is not serving anything.
    if (engine.child.exitCode !== null || engine.child.killed) {
      this.engines.delete(projectDir)
      return undefined
    }
    return engine.connection
  }

  /** The project dirs with a live engine (used by tests and shutdown). */
  served(): string[] {
    return [...this.engines.keys()]
  }

  /**
   * Start an engine for this project, or hand back the one already serving it.
   * Concurrent calls for the same dir share one start, so the parallel opens a
   * session restore fires cannot spawn duplicate engines for one project.
   */
  start(projectDir: string): Promise<EngineConnection> {
    const live = this.current(projectDir)
    if (live !== undefined) return Promise.resolve(live)
    const pending = this.starting.get(projectDir)
    if (pending !== undefined) return pending
    const started = this.spawnEngine(projectDir).finally(() => {
      this.starting.delete(projectDir)
    })
    this.starting.set(projectDir, started)
    return started
  }

  private spawnEngine(projectDir: string): Promise<EngineConnection> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.nodeBin, [this.enginePath, 'serve', projectDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.spawnEnv,
      })
      let buffer = ''
      let stderr = ''
      let settled = false

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const handshake = parseHandshake(line.trim())
          if (handshake !== undefined && !settled) {
            settled = true
    void this.confirmReady(handshake, child, projectDir, resolve, reject)
            return
          }
        }
      }

      child.stdout?.on('data', onData)
      child.on('close', (code) => {
        // However it ends, it is no longer serving this project. Guard on
        // identity so a restart's new child is never evicted by the old one.
        if (this.engines.get(projectDir)?.child === child) this.engines.delete(projectDir)
        if (!settled) {
          settled = true
          const detail = stderr.trim() === '' ? '' : `: ${stderr.trim().split('\n').slice(-8).join('\n')}`
          reject(new Error(`engine exited before handshake (code ${code ?? 'unknown'})${detail}`))
        }
      })
      child.on('error', (err) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      })
    })
  }

  private async confirmReady(
    handshake: Handshake,
    child: ChildProcess,
    projectDir: string,
    resolve: (c: EngineConnection) => void,
    reject: (e: Error) => void,
  ): Promise<void> {
    const url = `http://127.0.0.1:${handshake.port}/health`
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const res = await this.fetchFn(url)
        if (res.ok) {
          const connection = {
            port: handshake.port,
            token: handshake.token,
            projectRoot: handshake.projectRoot,
          }
          this.engines.set(projectDir, { child, connection })
          resolve(connection)
          return
        }
      } catch {
        // engine not listening yet
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    reject(new Error('engine handshook but never became healthy'))
  }

  /** Stop the engine serving one project (no-op when it isn't running). */
  stop(projectDir: string): void {
    const engine = this.engines.get(projectDir)
    if (engine === undefined) return
    this.engines.delete(projectDir)
    engine.child.kill('SIGTERM')
  }

  /** Stop every engine. Used on quit, when all windows close, and by tests. */
  stopAll(): void {
    for (const dir of this.served()) this.stop(dir)
  }
}
