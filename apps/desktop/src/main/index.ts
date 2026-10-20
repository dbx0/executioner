import { spawn, execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import { globalLayout } from '@exe/protocol'
import { collectConnectionHints } from './connection-hints.js'
import { EngineSupervisor } from './engine-supervisor.js'
import { createIpcHandlers } from './ipc.js'
import { allowPermission, externalUrl, isAppUrl } from './security.js'

const here = dirname(fileURLToPath(import.meta.url))

const rendererFile = join(here, '..', 'renderer', 'index.html')

/** The page the window loads: the dev server in dev, the bundled file when built. */
const appUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererFile).href

// In a packaged app the engine bundle and the logo are shipped as extraResources
// under process.resourcesPath (see electron-builder.yml); in dev they live in the
// monorepo build output / apps/desktop/resources.
const logoPath = app.isPackaged
  ? join(process.resourcesPath, 'logo.png')
  : join(here, '..', '..', 'resources', 'logo.png')

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

const spawnEnv: NodeJS.ProcessEnv = app.isPackaged
  ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  : process.env

const supervisor = new EngineSupervisor({ enginePath, nodeBin, spawnEnv })

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
    } catch {
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
    } catch {
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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
  win.on('maximize', () => win.webContents.send('window-maximized', true))
  win.on('unmaximize', () => win.webContents.send('window-maximized', false))

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

/** `ipcMain.handle`, refusing a caller that is not the app's own page. */
function handle<T>(channel: string, listener: (req: T) => unknown): void {
  ipcMain.handle(channel, (event, req: T) => {
    if (!fromApp(event)) throw new Error('refused: not the app')
    return listener(req)
  })
}

/** `ipcMain.on`, ignoring a sender that is not the app's own page. */
function listen<T>(channel: string, listener: (req: T) => void): void {
  ipcMain.on(channel, (event, req: T) => {
    if (fromApp(event)) listener(req)
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
  } catch {
    /* no logo available */
  }
  createWindow()
})

app.on('window-all-closed', () => {
  supervisor.stopAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => supervisor.stopAll())
