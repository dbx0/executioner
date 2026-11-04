import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { ConnectionHints } from './connection-hints.js'
import type { EngineConnection, EngineSupervisor } from './engine-supervisor.js'
import { hasPhoto, photoPath, removePhoto, writePhoto } from './engagement-photo.js'
import { mainLogger } from './logging/logger.js'

export interface OpenProjectRequest {
  dir: string
  create: boolean
  name?: string
  /** An emoji icon for the engagement, persisted to config on create. */
  icon?: string
  /** Program description written into HUNT.md on create. */
  description?: string
  /** Free-form scope written into docs/SCOPE.md on create. */
  scope?: string
}

/** The metadata `initProject` bakes into a freshly created engagement. */
export interface InitProjectOptions {
  name: string
  icon?: string
  description?: string
  scope?: string
}

export interface IpcHandlerDeps {
  supervisor: EngineSupervisor
  pickFolder: () => Promise<string | undefined>
  initProject: (dir: string, options: InitProjectOptions) => Promise<void>
  /** Whether an agent CLI binary resolves on PATH (used before any engagement). */
  probeAgent: (binary: string) => Promise<boolean>
  /** Run a stateless engine CLI command, feeding it `input` as JSON on stdin and
   *  parsing its JSON stdout. Used to verify a backend before any engagement. */
  runEngineJson: (args: string[], input: unknown) => Promise<unknown>
  /** Where a generated SSH key goes when there is no engagement to hold it. */
  sshKeyDir: () => string
  /** Values the connection form can prefill or offer, read off this machine. */
  connectionHints: () => Promise<ConnectionHints>
  /** Open the native image picker; returns the chosen file, or undefined. */
  pickImage: () => Promise<string | undefined>
  /**
   * Read an image off disk and re-encode it as a small square PNG data URL, or
   * null when the file is missing or not a readable image. Every photo badge —
   * imported or read back — goes through this, so the renderer only ever holds
   * a bounded, known-good PNG.
   */
  encodeImage: (path: string) => string | null
}

export interface AgentAvailability {
  id: string
  installed: boolean
}

export interface IpcHandlers {
  pickFolder(): Promise<string | undefined>
  openProject(req: OpenProjectRequest): Promise<EngineConnection>
  /** Stop the engine serving one engagement, when its tab is closed. */
  closeProject(req: { dir: string }): void
  checkAgents(): Promise<AgentAvailability[]>
  testBackend(req: { profile: unknown; createWorkdir?: boolean }): Promise<unknown>
  enrollSsh(req: unknown): Promise<unknown>
  connectionHints(): Promise<ConnectionHints>
  /** Pick an image and return it as a PNG data URL, before any engagement has to
   *  exist — the New-engagement modal previews it while the folder is still being
   *  chosen. Null when the user cancels or the file isn't a readable image. */
  pickEngagementPhoto(): Promise<string | null>
  /** The photo badge stored in an engagement folder, or null if it has none. */
  readEngagementPhoto(req: { root: string }): Promise<string | null>
  /** Store a photo badge in the engagement folder. Returns what was stored (so
   *  the caller renders exactly the bytes on disk), or null if it was rejected. */
  writeEngagementPhoto(req: { root: string; dataUrl: string }): Promise<string | null>
  /** Drop an engagement's photo badge (choosing an emoji, or clearing it). */
  clearEngagementPhoto(req: { root: string }): void
}

/** The agent CLIs the onboarding flow probes for, before any engine is running. */
const AGENT_BINARIES: { id: string; binary: string }[] = [
  { id: 'claude', binary: 'claude' },
  { id: 'codex', binary: 'codex' },
  { id: 'opencode', binary: 'opencode' },
  { id: 'gemini', binary: 'gemini' },
  { id: 'cursor', binary: 'cursor-agent' },
  { id: 'hermes', binary: 'hermes' },
]

/**
 * True for a value that can be an engagement folder: an absolute path to a
 * directory that exists. The photo handlers write under whatever root they are
 * given, so a stray string must not make them create folders elsewhere.
 */
export function isEngagementRoot(root: unknown): root is string {
  if (typeof root !== 'string' || root === '' || !isAbsolute(root)) return false
  try {
    return statSync(root).isDirectory()
  } catch {
    return false
  }
}

const BROWSER_ID = /^[A-Za-z0-9_-]{1,64}$/

/** True for a browser IPC request aimed at a served engagement with a well-formed browser id. */
export function validBrowserTarget(served: string[], req: unknown): req is { root: string; id: string } {
  if (typeof req !== 'object' || req === null) return false
  const { root, id } = req as { root?: unknown; id?: unknown }
  return typeof root === 'string' && served.includes(root) && typeof id === 'string' && BROWSER_ID.test(id)
}

/** The bounds the renderer reports for a browser pane; null means not on screen. */
export function validBounds(b: unknown): b is { x: number; y: number; width: number; height: number } | null {
  if (b === null) return true
  if (typeof b !== 'object') return false
  const { x, y, width, height } = b as Record<string, unknown>
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** An address-bar operation: a fixed verb, or a navigation to a string URL. */
export function validBrowserOp(op: unknown): op is 'back' | 'forward' | 'reload' | 'stop' | { navigate: string } {
  if (op === 'back' || op === 'forward' || op === 'reload' || op === 'stop') return true
  return (
    typeof op === 'object' && op !== null && typeof (op as { navigate?: unknown }).navigate === 'string'
  )
}

export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {

  return {
    pickFolder: () => deps.pickFolder(),

    // Both of these run the engine as a one-shot process rather than through an
    // engagement's HTTP API: the liveness test and the key enrollment touch no
    // project state, so onboarding can verify a connection before any engagement
    // is open. Input goes over stdin so a password never reaches the process list.
    testBackend: (req) =>
      logged(
        'Backend test',
        { kind: profileKind(req.profile) },
        deps.runEngineJson(['backend-test', ...(req.createWorkdir === true ? ['--create-workdir'] : [])], req.profile),
      ),

    enrollSsh: (req) =>
      logged('SSH key enrollment', {}, deps.runEngineJson(['ssh-enroll', '--key-dir', deps.sshKeyDir()], req)),

    connectionHints: () => deps.connectionHints(),

    async pickEngagementPhoto() {
      const source = await deps.pickImage()
      if (source === undefined) return null
      return deps.encodeImage(source)
    },

    async readEngagementPhoto({ root }) {
      if (!isEngagementRoot(root)) return null
      // Read straight from disk rather than trusting a remembered copy: the file
      // is the engagement's identity, so a photo replaced (or deleted) outside
      // the app still shows correctly the next time it is opened.
      if (!hasPhoto(root)) return null
      return deps.encodeImage(photoPath(root))
    },

    async writeEngagementPhoto({ root, dataUrl }) {
      if (!isEngagementRoot(root) || typeof dataUrl !== 'string' || !writePhoto(root, dataUrl)) return null
      return deps.encodeImage(photoPath(root))
    },

    clearEngagementPhoto({ root }) {
      if (isEngagementRoot(root)) removePhoto(root)
    },

    async openProject(req) {
      // Reopening a project that is already served must NOT restart its engine.
      // The renderer calls this on every reload (session restore), and stopping a
      // live engine kills every tool process an in-flight run had spawned — a
      // refresh would silently abort a scan that was minutes deep.
      //
      // Opening a *different* project leaves the first one's engine running:
      // engagements are concurrent tabs, each with its own port and token, and
      // background runs must survive a tab switch. `start` is keyed by dir and
      // de-duplicates concurrent calls, so a restore opening several at once
      // gets one engine each.
      if (!req.create) {
        const live = deps.supervisor.current(req.dir)
        if (live !== undefined) return live
      }
      if (req.create) {
        await deps.initProject(req.dir, {
          name: req.name ?? 'project',
          ...(req.icon !== undefined ? { icon: req.icon } : {}),
          ...(req.description !== undefined ? { description: req.description } : {}),
          ...(req.scope !== undefined ? { scope: req.scope } : {}),
        })
      }
      return await deps.supervisor.start(req.dir)
    },

    closeProject(req) {
      deps.supervisor.stop(req.dir)
    },

    async checkAgents() {
      return Promise.all(
        AGENT_BINARIES.map(async ({ id, binary }) => ({
          id,
          installed: await deps.probeAgent(binary).catch((err: unknown) => {
            mainLogger()?.debug('main/agents', 'Agent probe failed', { agent: id, error: String(err) })
            return false
          }),
        })),
      )
    },
  }
}

/** A backend profile's kind (local, ssh, docker), the only part of it a log line names. */
function profileKind(profile: unknown): unknown {
  return typeof profile === 'object' && profile !== null ? (profile as { kind?: unknown }).kind : undefined
}

/**
 * Log a one-shot engine command's outcome: whether it passed and which step
 * failed, never the steps' details (they name hosts and users).
 */
async function logged<T>(what: string, data: Record<string, unknown>, run: Promise<T>): Promise<T> {
  try {
    const res = await run
    const r = (typeof res === 'object' && res !== null ? res : {}) as { ok?: unknown; steps?: unknown }
    const failed = Array.isArray(r.steps)
      ? (r.steps as Array<{ name?: unknown; ok?: unknown }>).find((step) => step.ok === false)?.name
      : undefined
    mainLogger()?.info('main/backends', what, { ...data, ok: r.ok === true, ...(typeof failed === 'string' ? { failedStep: failed } : {}) })
    return res
  } catch (err) {
    mainLogger()?.warn('main/backends', `${what} could not run`, { ...data, error: String(err) })
    throw err
  }
}
