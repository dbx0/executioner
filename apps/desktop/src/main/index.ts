import { spawn, execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { realpathSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import { BROWSER_APP_CLOSED, globalLayout } from '@exe/protocol'
import type { LogLine } from '@exe/protocol'
import { collectConnectionHints } from './connection-hints.js'
import { BrowserHostClient } from './browser/host-client.js'
import { BrowserManager, type DialogInfo } from './browser/manager.js'
import { EngineSupervisor, type EngineConnection } from './engine-supervisor.js'
import { editMenuTemplate } from './edit-menu.js'
import { coalesced } from './logging/coalesce.js'
import { buildExport, type ExportRequest } from './logging/export.js'
import { MainLogger, rendererLine, setMainLogger, type LogSink } from './logging/logger.js'
import { readSession, SessionLog } from './logging/session-log.js'
import { effectiveLevel, pushEngineLevel, readLoggingSettings, writeLoggingSettings } from './logging/settings.js'
import { createIpcHandlers, validBounds, validBrowserOp, validBrowserTarget } from './ipc.js'
import { allowPermission, externalUrl, isAppUrl } from './security.js'
import { resolveShellEnv } from './shell-path.js'
import { showSplash, type Splash } from './splash.js'
import { checkForUpdate, downloadUpdate, installKind, startInstall } from './update.js'

const here = dirname(fileURLToPath(import.meta.url))

// The session log opens before anything else so startup problems are on disk.
// Opening it runs retention, which prunes old crash dumps, so it goes before
// the crash reporter starts writing new ones. A home the app cannot write to
// must not stop it starting: logging then goes nowhere.
let sessionLog: SessionLog | undefined
try {
  sessionLog = SessionLog.open({ dir: globalLayout.logs(), crashDir: globalLayout.logCrashes() })
} catch {
  sessionLog = undefined
}
const logSink: LogSink = sessionLog ?? { write: () => {} }
const logger = new MainLogger({ session: logSink })
setMainLogger(logger)
logger.setLevel(effectiveLevel(readLoggingSettings(globalLayout.loggingConfig()), process.argv, process.env))
try {
  app.setPath('crashDumps', globalLayout.logCrashes())
  crashReporter.start({ uploadToServer: false })
} catch (err) {
  logger.warn('main', 'Native crash reporting unavailable', { error: String(err) })
}

// The handler is the monitor variant so Electron's own handling of an uncaught
// exception carries on unchanged; the line is on disk before it does.
process.on('uncaughtExceptionMonitor', (err) => {
  logger.flushUnmasked('uncaughtException')
  logger.error('main', 'Uncaught exception', { error: String(err), stack: err instanceof Error ? err.stack : undefined })
})
process.on('unhandledRejection', (reason) => {
  logger.flushUnmasked('unhandledRejection')
  logger.error('main', 'Unhandled promise rejection', {
    error: String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
  console.error('Unhandled promise rejection:', reason)
})

const rendererFile = join(here, '..', 'renderer', 'index.html')

/** The page the window loads: the dev server in dev, the bundled file when built. */
const appUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererFile).href

// In a packaged app the engine bundle and the logo are shipped as extraResources
// under process.resourcesPath (see electron-builder.yml); in dev they live in the
// monorepo build output / apps/desktop/resources.
const logoPath = app.isPackaged
  ? join(process.resourcesPath, 'logo.png')
  : join(here, '..', '..', 'resources', 'logo.png')
const splashPath = app.isPackaged
  ? join(process.resourcesPath, 'splash.jpg')
  : join(here, '..', '..', 'resources', 'splash.jpg')

// Packaged: the engine ships inside the app bundle as a production dependency at
// node_modules/@exe/engine (app.getAppPath() -> …/Resources/app.asar; Electron
// run as Node reads inside the asar). Dev: it lives in the monorepo build output.
const enginePath = app.isPackaged
  ? join(app.getAppPath(), 'node_modules', '@exe', 'engine', 'dist', 'cli.js')
  : join(here, '..', '..', '..', '..', 'packages', 'engine', 'dist', 'cli.js')

// Packaged: run the engine with the Electron binary itself as Node
// (process.execPath + ELECTRON_RUN_AS_NODE=1), so the app needs no Node of its
// own; the native deps (better-sqlite3, node-pty) are Node-API addons and load
// under it as shipped. Dev: use the Node that launched the dev script (else
// `node` on PATH) with no ELECTRON_RUN_AS_NODE.
const nodeBin = app.isPackaged
  ? process.execPath
  : (process.env.npm_node_execpath ?? 'node')

// A packaged app opened from Finder/Dock inherits launchd's bare PATH, so take
// the login shell's PATH; otherwise the engine can't find the agent CLIs.
const baseEnv: NodeJS.ProcessEnv = app.isPackaged ? resolveShellEnv(process.env) : process.env
if (app.isPackaged) process.env.PATH = baseEnv.PATH

const spawnEnv: NodeJS.ProcessEnv = app.isPackaged
  ? { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' }
  : baseEnv

/** Whether two paths name one folder; the engine may report a resolved form of the dir it was given. */
function sameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return resolve(a) === resolve(b)
  }
}

/** One host client per served project dir, remembering the root its pages are keyed by. */
const hostClients = new Map<string, { root: string; client: BrowserHostClient }>()
let browserManager: BrowserManager | undefined

const supervisor = new EngineSupervisor({
  enginePath,
  nodeBin,
  spawnEnv,
  onLog: (line: LogLine) => logger.log(line),
  logLevel: () => logger.level(),
  // The engine asks the app to host its embedded browsers over a socket. A
  // restarted engine reports ready again, so the old client for that dir goes first.
  onReady: (conn: EngineConnection) => {
    logger.addMask(conn.token)
    logger.info('main', 'Engine ready', { engagement: conn.projectRoot })
    for (const [dir, entry] of hostClients) {
      if (entry.root === conn.projectRoot) {
        entry.client.stop()
        hostClients.delete(dir)
      }
    }
    const client = new BrowserHostClient({
      url: `ws://127.0.0.1:${conn.port}/browser-host?token=${encodeURIComponent(conn.token)}`,
      run: (call) => {
        if (browserManager === undefined) throw new Error(BROWSER_APP_CLOSED)
        return browserManager.run(conn.projectRoot, call)
      },
    })
    hostClients.set(conn.projectRoot, { root: conn.projectRoot, client })
    client.start()
  },
  onExit: (dir) => {
    for (const [key, entry] of hostClients) {
      if (key === dir || entry.root === dir || sameDir(entry.root, dir)) {
        entry.client.stop()
        hostClients.delete(key)
        browserManager?.closeRoot(entry.root)
      }
    }
  },
})

function runEngineCli(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [enginePath, ...args], { stdio: 'inherit', env: spawnEnv })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`cli ${args[0]} failed`))))
    child.on('error', reject)
  })
}

/** Run a stateless engine CLI command: `input` goes in as JSON on stdin (so a
 *  password never lands in argv) and the JSON it prints comes back parsed. */
function runEngineJson<T>(args: string[], input: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [enginePath, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: spawnEnv })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() === '' ? `engine ${args[0]} exited ${String(code)}` : err.trim()))
        return
      }
      try {
        resolve(JSON.parse(out) as T)
      } catch {
        reject(new Error(`engine ${args[0]} returned unreadable output`))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}

let mainWindow: BrowserWindow | undefined

/** Pixel size an engagement photo badge is stored and rendered at. */
const PHOTO_SIZE = 128

/** Resolve whether an agent CLI binary is on PATH, without starting the engine.
 *  Uses the platform's lookup builtin; a login shell picks up user PATH edits
 *  (nvm, Homebrew, ~/.local/bin) that a bare GUI-launched process misses. */
function probeAgent(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        execFile('where', [binary], { windowsHide: true, timeout: 5000 }, (err) => resolve(err === null))
      } else {
        const shell = process.env.SHELL ?? '/bin/bash'
        execFile(shell, ['-lc', `command -v ${binary}`], { timeout: 5000 }, (err, stdout) =>
          resolve(err === null && stdout.trim() !== ''),
        )
      }
    } catch (err) {
      logger.debug('main/agents', 'Agent probe could not start', { agent: binary, error: String(err) })
      resolve(false)
    }
  })
}

/**
 * Where the next file dialog opens. Since Electron 43 a dialog without a
 * defaultPath starts in Downloads instead of wherever the user last browsed, so
 * the last chosen location is tracked here to keep the old behaviour.
 */
let lastDialogDir: string | undefined

async function showOpenDialog(options: OpenDialogOptions): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    ...options,
    ...(lastDialogDir !== undefined ? { defaultPath: lastDialogDir } : {}),
  })
  const picked = result.canceled ? undefined : result.filePaths[0]
  if (picked !== undefined) lastDialogDir = dirname(picked)
  return picked
}

const handlers = createIpcHandlers({
  supervisor,
  runEngineJson,
  // Generated keys sit next to the connections they belong to: user-level, so
  // one works in every engagement — the same directory the engine enrolls into.
  sshKeyDir: () => globalLayout.sshKeys(),
  connectionHints: () => collectConnectionHints(),
  pickFolder: () => showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }),
  pickImage: () =>
    showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'] }],
    }),
  encodeImage: (path: string) => {
    // Electron decodes every format the picker offers, so the renderer never
    // deals with jpg/webp/ico: one square PNG, small enough that the badge can
    // be kept in the recents list without bloating local storage, big enough
    // for a 40px badge on a 2x display.
    try {
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) return null
      return image.resize({ width: PHOTO_SIZE, height: PHOTO_SIZE, quality: 'good' }).toDataURL()
    } catch (err) {
      logger.warn('main', 'Could not read the engagement photo', { error: String(err) })
      return null
    }
  },
  initProject: (dir, options) =>
    runEngineCli([
      'init',
      dir,
      '--name',
      options.name,
      ...(options.icon !== undefined && options.icon !== '' ? ['--icon', options.icon] : []),
      ...(options.description !== undefined && options.description !== '' ? ['--description', options.description] : []),
      ...(options.scope !== undefined && options.scope !== '' ? ['--scope', options.scope] : []),
    ]),
  probeAgent,
})

/** Answers a page's JavaScript dialog for the operator with a native message box. */
async function askBrowserDialog(win: BrowserWindow, d: DialogInfo): Promise<{ accept: boolean; promptText?: string }> {
  const confirming = d.type !== 'alert'
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    message: d.message === '' ? `The page at ${d.url} has a message` : d.message,
    detail: `Page: ${d.url}`,
    buttons: confirming ? ['OK', 'Cancel'] : ['OK'],
    defaultId: 0,
    cancelId: confirming ? 1 : 0,
  })
  const accept = response === 0
  return d.type === 'prompt' && accept ? { accept, promptText: d.defaultPrompt } : { accept }
}

/** Where the renderer's startup reports go while the splash is up; gone once the app shows. */
let startupProgress: { progress(fraction: number): void; ready(): void } | undefined

function createWindow(splash?: Splash): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // Hidden until its first paint, so the splash (or nothing) shows meanwhile
    // instead of a blank frame.
    show: false,
    // Frameless window with a renderer-drawn 36px titlebar (see Titlebar.tsx).
    // macOS 'hiddenInset' keeps the native traffic lights over our custom bar;
    // Windows 'hidden' removes the OS title bar so it doesn't double up.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : process.platform === 'win32'
        ? { titleBarStyle: 'hidden' as const }
        : {}),
    // Linux ignores titleBarStyle; frame:false drops the native frame so the
    // renderer's own titlebar isn't stacked under a native one.
    ...(process.platform === 'linux' ? { frame: false } : {}),
    // Position the traffic lights vertically centered in the 36px bar
    // (center 18 - radius 6 = 12), left inset 16.
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 12 } }
      : {}),
    webPreferences: {
      preload: join(here, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // Links marked target="_blank" (the skills CTA, docs pointers) belong in the
  // user's browser, not in a second chrome-less Electron window. Only web links
  // leave: any other scheme would launch whatever the desktop registered for it.
  // The renderer-drawn maximize button swaps its icon with the window state.
  const win = mainWindow
  // The embedded browsers draw as native views over this window. The window is
  // the only thing state is pushed to; dialogs are native boxes because the
  // renderer's DOM cannot draw over a native view.
  browserManager = new BrowserManager(
    win,
    (root, id, state) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('browser-state', { root, id, state })
    },
    (_root, _id, d) => askBrowserDialog(win, d),
  )
  win.on('closed', () => {
    // Native views outlive their window, so every page goes now. The host clients
    // stay (macOS can open a new window); until then their calls answer BROWSER_APP_CLOSED.
    browserManager?.closeAll()
    browserManager = undefined
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('main', 'Window renderer gone', { reason: details.reason, exitCode: details.exitCode })
  })
  win.on('unresponsive', () => logger.warn('main', 'Window unresponsive'))
  win.on('responsive', () => logger.info('main', 'Window responsive again'))
  win.on('maximize', () => win.webContents.send('window-maximized', true))
  win.on('unmaximize', () => win.webContents.send('window-maximized', false))
  // Regaining focus or being restored leaves the native browser views showing a
  // stale frame on Linux until they change; nudge them to redraw.
  win.on('focus', () => browserManager?.repaintAll())
  win.on('show', () => browserManager?.repaintAll())
  win.on('restore', () => browserManager?.repaintAll())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url)
    if (external !== null) void shell.openExternal(external)
    return { action: 'deny' }
  })

  // This window holds the engine's bearer token, so it never shows anything but
  // the app. A plain link in a finding, a file or an agent's markdown would
  // otherwise navigate it to a page that could call the preload bridge; such a
  // link opens in the browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, appUrl)) return
    event.preventDefault()
    const external = externalUrl(url)
    if (external !== null) void shell.openExternal(external)
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, appUrl)) event.preventDefault()
  })

  // Electron shows no right-click menu of its own. Text fields and the terminal
  // get Cut, Copy, Paste and Select all; everywhere else stays menu-less.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = editMenuTemplate(params)
    // The menu pops over the window as a native surface; on Linux that leaves
    // any embedded browser view blank until it redraws, so repaint on close.
    if (template !== null) Menu.buildFromTemplate(template).popup({ window: win, callback: () => browserManager?.repaintAll() })
  })

  // The window appears once it has painted and the renderer says the last
  // session's engagements are back (or there were none). Until then the splash
  // stays up and its bar follows the page load, then the restore.
  let revealed = false
  let painted = false
  let restored = false
  const reveal = (): void => {
    if (revealed) return
    revealed = true
    startupProgress = undefined
    const show = (): void => {
      if (!win.isDestroyed()) win.show()
    }
    if (splash === undefined) show()
    else void splash.finish(show)
  }
  const revealWhenReady = (): void => {
    if (painted && restored) reveal()
  }
  win.webContents.once('did-start-loading', () => splash?.progress(0.25))
  win.webContents.once('dom-ready', () => splash?.progress(0.35))
  win.once('ready-to-show', () => {
    painted = true
    splash?.progress(0.45)
    revealWhenReady()
    // Engines that hang must not keep the app hidden for good.
    setTimeout(reveal, 30_000)
  })
  startupProgress = {
    progress: (fraction) => splash?.progress(0.45 + 0.5 * fraction),
    ready: () => {
      restored = true
      revealWhenReady()
    },
  }
  // A page that never paints must not leave the app invisible.
  setTimeout(reveal, 45_000)

  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(rendererFile)
  }
}

// No <webview> is ever wanted: refuse one before it can attach with its own preferences.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

/** Only the app's own page may drive the main process; a frame from anywhere else is ignored. */
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isAppUrl(event.senderFrame?.url ?? '', appUrl)
}

/**
 * Channels never timed in the verbose log: the renderer's own log lines (a
 * line per line would feed back into itself), the Logs page's polling (it
 * would fill the page it shows) and the per-frame ones.
 */
const UNLOGGED_IPC: ReadonlySet<string> = new Set([
  'log-write',
  'log-read',
  'log-sessions',
  'log-current-session',
  'log-get-verbose',
  'browser-place',
  'browser-occluded',
  'startup-progress',
])

/** One verbose line per IPC call: channel, duration, outcome. Never the payload. */
function logIpc(channel: string, started: number, err?: unknown): void {
  const ms = Math.round(performance.now() - started)
  if (err === undefined) {
    logger.debug('main/ipc', 'IPC call', { channel, ms, ok: true })
    return
  }
  const e = err instanceof Error ? err : new Error(String(err))
  logger.debug('main/ipc', 'IPC call', { channel, ms, ok: false, name: e.name, message: e.message })
}

/** `ipcMain.handle`, refusing a caller that is not the app's own page. */
function handle<T>(channel: string, listener: (req: T) => unknown): void {
  ipcMain.handle(channel, async (event, req: T) => {
    if (!fromApp(event)) throw new Error('refused: not the app')
    if (UNLOGGED_IPC.has(channel) || logger.level() !== 'debug') return listener(req)
    const started = performance.now()
    try {
      const out = await listener(req)
      logIpc(channel, started)
      return out
    } catch (err) {
      logIpc(channel, started, err)
      throw err
    }
  })
}

/** `ipcMain.on`, ignoring a sender that is not the app's own page. */
function listen<T>(channel: string, listener: (req: T) => void): void {
  ipcMain.on(channel, (event, req: T) => {
    if (!fromApp(event)) return
    if (UNLOGGED_IPC.has(channel) || logger.level() !== 'debug') {
      listener(req)
      return
    }
    const started = performance.now()
    try {
      listener(req)
      logIpc(channel, started)
    } catch (err) {
      logIpc(channel, started, err)
      throw err
    }
  })
}

handle('pick-folder', () => handlers.pickFolder())
/** The argument an IPC handler takes, as the renderer sends it. */
type Req<K extends keyof typeof handlers> = Parameters<(typeof handlers)[K]>[0]

handle('open-project', (req: Req<'openProject'>) => handlers.openProject(req))
listen('close-project', (req: { dir: string }) => handlers.closeProject(req))
handle('check-agents', () => handlers.checkAgents())
handle('test-backend', (req: Req<'testBackend'>) => handlers.testBackend(req))
handle('enroll-ssh', (req: Req<'enrollSsh'>) => handlers.enrollSsh(req))
handle('connection-hints', () => handlers.connectionHints())
handle('pick-engagement-photo', () => handlers.pickEngagementPhoto())
handle('read-engagement-photo', (req: Req<'readEngagementPhoto'>) => handlers.readEngagementPhoto(req))
handle('write-engagement-photo', (req: Req<'writeEngagementPhoto'>) => handlers.writeEngagementPhoto(req))
listen('clear-engagement-photo', (req: { root: string }) => handlers.clearEngagementPhoto(req))

// Embedded browser: the renderer reports where a pane sits and drives the address
// bar; everything else reaches the pages through the engine. Every request must name
// a served engagement and a well-formed browser id.
function servedRoots(): string[] {
  const dirs = supervisor.served()
  return [...dirs, ...dirs.map((d) => supervisor.current(d)?.projectRoot).filter((r): r is string => r !== undefined)]
}

/** The root pages are keyed by (the engine's project root) for any root the renderer may name. */
function canonicalRoot(root: string): string | undefined {
  for (const dir of supervisor.served()) {
    const conn = supervisor.current(dir)
    if (conn !== undefined && (sameDir(root, dir) || sameDir(root, conn.projectRoot))) return conn.projectRoot
  }
  return undefined
}

listen('browser-place', (req: unknown) => {
  if (!validBrowserTarget(servedRoots(), req)) return
  const bounds = (req as { bounds?: unknown }).bounds ?? null
  if (!validBounds(bounds)) return
  const root = canonicalRoot(req.root)
  if (root === undefined) return
  browserManager?.place(root, req.id, bounds)
})
listen('browser-occluded', (req: unknown) => {
  const occluded = (req as { occluded?: unknown } | null)?.occluded
  if (typeof occluded === 'boolean') browserManager?.setOccluded(occluded)
})
handle('browser-operator', async (req: unknown) => {
  if (!validBrowserTarget(servedRoots(), req)) throw new Error('browser-operator: unknown engagement or browser')
  const op = (req as { op?: unknown }).op
  if (!validBrowserOp(op)) throw new Error('browser-operator: bad operation')
  if (browserManager === undefined) throw new Error('browser-operator: no window')
  const root = canonicalRoot(req.root)
  if (root === undefined) throw new Error('browser-operator: unknown engagement or browser')
  await browserManager.operator(root, req.id, op)
})

// The terminal's clipboard. Electron 44 took the clipboard module out of the
// renderer (preload included), so the main process serves it, to the app's own
// page only, like every other channel.
handle('clipboard-read-text', () => clipboard.readText())
handle('clipboard-write-text', (text: unknown) => {
  if (typeof text !== 'string') throw new Error('clipboard-write-text: expected a string')
  return clipboard.writeText(text)
})

// Minimize, maximize and close for the frameless window on Windows and Linux,
// drawn by the renderer's titlebar (macOS keeps its native traffic lights).
listen('window-control', (action: unknown) => {
  const win = mainWindow
  if (win === undefined || win.isDestroyed()) return
  if (action === 'minimize') win.minimize()
  else if (action === 'maximize') {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  } else if (action === 'close') win.close()
})

// Update notice: the renderer asks once on startup. Only a copy the install
// scripts put in place can update itself; anything else gets the release page.
const updateKind = installKind({
  packaged: app.isPackaged,
  platform: process.platform,
  execPath: process.execPath,
  home: app.getPath('home'),
  localAppData: process.env.LOCALAPPDATA,
})
let pendingUpdateTag: string | undefined

logger.info('main', 'App started', {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  installKind: updateKind,
  verbose: logger.level() === 'debug',
})
{
  const crashed = sessionLog?.previousCrashed() ?? null
  if (crashed !== null) {
    logger.warn('main', 'Previous session ended unexpectedly', { session: crashed.id, startedAt: crashed.startedAt })
  }
}

handle('check-for-update', async () => {
  try {
    const info = await checkForUpdate({
      current: app.getVersion(),
      kind: updateKind,
      // Node's fetch, not Electron's net.fetch: net.fetch follows the
      // /releases/latest redirect but reports an empty response.url, so the tag
      // could never be read and no update was ever found.
    })
    pendingUpdateTag = info?.tag
    logger.info('main/update', info === null ? 'Update check: up to date' : 'Update check: newer release found', {
      current: app.getVersion(),
      ...(info !== null ? { latest: info.tag } : {}),
    })
    return info
  } catch (err) {
    // Offline or GitHub unreachable: no notice, not an error.
    logger.debug('main/update', 'Update check failed', { error: String(err) })
    return null
  }
})
// The finished download, ready for a restart to install. Discarded on a quit
// that does not install it, so a stale download never lingers in temp.
let downloadedUpdate: { tag: string; dir: string } | undefined
let downloadingUpdate: Promise<void> | undefined
let installingUpdate = false

handle('download-update', () => {
  if (updateKind === null || pendingUpdateTag === undefined) throw new Error('no update to download')
  if (downloadedUpdate?.tag === pendingUpdateTag) return
  if (downloadingUpdate !== undefined) return downloadingUpdate
  const kind = updateKind
  const tag = pendingUpdateTag
  downloadingUpdate = (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'executioner-update-'))
    try {
      await downloadUpdate({
        kind,
        tag,
        arch: process.arch,
        dir,
        onProgress: (p) => {
          const win = mainWindow
          if (win !== undefined && !win.isDestroyed()) win.webContents.send('update-progress', p)
        },
      })
      downloadedUpdate = { tag, dir }
      logger.info('main/update', 'Update downloaded', { tag })
    } catch (err) {
      logger.warn('main/update', 'Update download failed', { tag, error: String(err) })
      await rm(dir, { recursive: true, force: true })
      throw err
    }
  })().finally(() => {
    downloadingUpdate = undefined
  })
  return downloadingUpdate
})
handle('install-update', () => {
  if (updateKind === null || downloadedUpdate === undefined) throw new Error('no downloaded update to install')
  startInstall({
    kind: updateKind,
    tag: downloadedUpdate.tag,
    dir: downloadedUpdate.dir,
    execPath: process.execPath,
    pid: process.pid,
  })
  installingUpdate = true
  logger.info('main/update', 'Installing update', { tag: downloadedUpdate.tag })
  app.quit()
})
app.on('will-quit', () => {
  // Must not throw: that would skip the clean-shutdown listener below and fake a crash next launch.
  try {
    if (downloadedUpdate !== undefined && !installingUpdate) rmSync(downloadedUpdate.dir, { recursive: true, force: true })
  } catch (err) {
    logger.warn('main/update', 'Could not remove the downloaded update', { message: err instanceof Error ? err.message : String(err) })
  }
})
// After the update cleanup above, so the session's last line is the shutdown.
app.on('will-quit', () => {
  logger.flushUnmasked('shutdown')
  logger.info('main', 'Clean shutdown')
  sessionLog?.close()
})

// App log: the renderer's lines, the Logs page, and the verbose switch.
listen('log-write', (req: unknown) => {
  const line = rendererLine(req)
  if (line !== null) logger.log(line)
})
handle('log-sessions', () => sessionLog?.sessions() ?? [])
handle('log-current-session', () => sessionLog?.info ?? null)
handle('log-read', (req: unknown) => {
  const { id, limit } = (req ?? {}) as { id?: unknown; limit?: unknown }
  if (typeof id !== 'string') throw new Error('log-read: expected a session id')
  if (limit !== undefined && !(typeof limit === 'number' && Number.isInteger(limit) && limit >= 0)) {
    throw new Error('log-read: bad limit')
  }
  const found = sessionLog?.sessions().find((s) => s.id === id)
  return found === undefined ? [] : readSession(found.file, limit)
})
handle('log-get-verbose', () => logger.level() === 'debug')
handle('log-set-verbose', (verbose: unknown) => {
  if (typeof verbose !== 'boolean') throw new Error('log-set-verbose: expected a boolean')
  try {
    writeLoggingSettings(globalLayout.loggingConfig(), { verbose })
  } catch (err) {
    logger.warn('main/logging', 'Could not save the verbose setting', { error: String(err) })
  }
  const level = verbose ? 'debug' : 'info'
  logger.setLevel(level)
  logger.info('main/logging', verbose ? 'Verbose logging on' : 'Verbose logging off')
  const win = mainWindow
  if (win !== undefined && !win.isDestroyed()) win.webContents.send('log-level', level)
  // Engines started from now on read the level from their env; running ones are told.
  void pushEngineLevel(supervisor.liveConnections(), level, fetch, (conn, error) =>
    logger.warn('main/logging', 'Could not change an engine log level', { engagement: conn.projectRoot, error }),
  )
})
/** Reload the known secret values every line is masked with. */
function loadLogMasks(): Promise<void> {
  return runEngineJson<{ values?: unknown }>(['log-masks'], {}).then(
    (res) => {
      const values = Array.isArray(res.values) ? res.values.filter((v): v is string => typeof v === 'string') : []
      logger.setMasks(values)
    },
    (err: unknown) => {
      logger.flushUnmasked('log-masks failed')
      logger.warn('main/logging', 'Could not load the secret mask list', { error: String(err) })
    },
  )
}
// One load in flight at a time, plus one trailing reload when asked during it,
// so an older, slower load can never land after a newer one.
const refreshLogMasks = coalesced(loadLogMasks)
void refreshLogMasks()
listen('log-refresh-masks', () => void refreshLogMasks())
handle('log-open-folder', () => shell.openPath(globalLayout.logs()))
handle('log-previous-crash', () => sessionLog?.previousCrashed() ?? null)
handle('log-export', async (req: ExportRequest) => {
  if (sessionLog === undefined) throw new Error('log-export: logging is unavailable')
  const log = sessionLog
  const { includeAllSessions, includeTargets, sessionId } = (req ?? {}) as Partial<ExportRequest>
  if (typeof includeAllSessions !== 'boolean' || typeof includeTargets !== 'boolean') {
    throw new Error('log-export: bad request')
  }
  if (sessionId !== undefined && typeof sessionId !== 'string') throw new Error('log-export: bad session id')
  const zip = buildExport({
    sessions: log.sessions(),
    current: log.info,
    ...(sessionId !== undefined ? { selected: sessionId } : {}),
    includeAllSessions,
    includeTargets,
    header: {
      version: app.getVersion(),
      os: process.platform,
      osVersion: release(),
      arch: process.arch,
      installKind: updateKind ?? 'none',
      electron: process.versions.electron,
      node: process.versions.node,
      verbose: logger.level() === 'debug',
      openEngagements: supervisor.liveConnections().length,
      previousCrashed: log.previousCrashed() !== null,
    },
    home: app.getPath('home'),
    crashDir: globalLayout.logCrashes(),
  })
  const name = `executioner-logs-${app.getVersion()}-${new Date().toISOString().slice(0, 10)}.zip`
  const win = mainWindow
  const options = {
    defaultPath: join(lastDialogDir ?? app.getPath('downloads'), name),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  }
  const result = win !== undefined && !win.isDestroyed() ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || result.filePath === undefined || result.filePath === '') return { cancelled: true }
  lastDialogDir = dirname(result.filePath)
  writeFileSync(result.filePath, zip)
  logger.info('main/logging', 'Exported logs', { includeAllSessions, includeTargets })
  return { saved: result.filePath }
})

listen('startup-progress', (fraction: unknown) => {
  if (typeof fraction === 'number' && Number.isFinite(fraction)) startupProgress?.progress(Math.max(0, Math.min(1, fraction)))
})
listen('startup-ready', () => startupProgress?.ready())

// Keep the native window appearance (macOS traffic lights + any native chrome)
// in step with the in-app theme's base, so a light theme doesn't leave dark,
// backgroundless-looking traffic lights.
listen('set-appearance', (mode: 'light' | 'dark') => {
  nativeTheme.themeSource = mode === 'light' ? 'light' : 'dark'
})

app.whenReady().then(() => {
  // Grant the renderer only the browser permissions it uses (notifications,
  // clipboard writes); camera, location and the rest are refused outright.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowPermission(permission, details.requestingUrl ?? contents.getURL(), appUrl))
  })
  // Dock/taskbar icon (dev + unpackaged). Guarded: a missing/bad file is a no-op.
  try {
    const icon = nativeImage.createFromPath(logoPath)
    if (!icon.isEmpty() && process.platform === 'darwin') app.dock?.setIcon(icon)
  } catch (err) {
    /* no logo available */
    logger.debug('main', 'Dock icon not set', { error: String(err) })
  }
  const splash = showSplash(splashPath)
  splash.progress(0.15)
  createWindow(splash)
})

app.on('window-all-closed', () => {
  // Off macOS this stops the engines before before-quit runs, so say so here.
  const count = supervisor.liveConnections().length
  if (count > 0) logger.info('main', 'Stopping engines', { count })
  supervisor.stopAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Logged here, synchronously: the engines' own exit lines arrive after the
  // session file has closed, so this is the last sign of the shutdown on disk.
  const count = supervisor.liveConnections().length
  if (count > 0) logger.info('main', 'Stopping engines', { count })
  supervisor.stopAll()
})
