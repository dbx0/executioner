import { contextBridge, ipcRenderer } from 'electron'

// The only surface the renderer sees. Everything else is plain HTTP to the engine.
contextBridge.exposeInMainWorld('executioner', {
  pickFolder: (): Promise<string | undefined> => ipcRenderer.invoke('pick-folder'),
  openProject: (req: {
    dir: string
    create: boolean
    name?: string
    icon?: string
    description?: string
    scope?: string
  }) =>
    ipcRenderer.invoke('open-project', req) as Promise<{
      port: number
      token: string
      projectRoot: string
    }>,
  // Closing an engagement tab stops that project's engine; the others keep
  // running, so a background scan is not collateral damage.
  closeProject: (req: { dir: string }): void => ipcRenderer.send('close-project', req),
  checkAgents: () => ipcRenderer.invoke('check-agents') as Promise<{ id: string; installed: boolean }[]>,
  // Verify a backend without an engagement: the engine runs one-shot in the main
  // process, so onboarding can prove a connection before a workspace exists.
  testBackend: (req: { profile: unknown; createWorkdir?: boolean }) => ipcRenderer.invoke('test-backend', req),
  enrollSsh: (req: { host: string; user: string; password: string; port?: number }) =>
    ipcRenderer.invoke('enroll-ssh', req),
  // ~/.ssh hosts and keys, this machine's username, local docker images — so the
  // connection form can prefill and offer instead of asking the user to type.
  connectionHints: () => ipcRenderer.invoke('connection-hints'),
  // Engagement photo badge: picked, stored inside the engagement folder, and
  // read back from there every time it is opened.
  pickEngagementPhoto: (): Promise<string | null> => ipcRenderer.invoke('pick-engagement-photo'),
  readEngagementPhoto: (req: { root: string }): Promise<string | null> =>
    ipcRenderer.invoke('read-engagement-photo', req),
  writeEngagementPhoto: (req: { root: string; dataUrl: string }): Promise<string | null> =>
    ipcRenderer.invoke('write-engagement-photo', req),
  clearEngagementPhoto: (req: { root: string }): void => ipcRenderer.send('clear-engagement-photo', req),
  // Startup update notice: the newer release, if any, and the in-place install.
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('install-update') as Promise<void>,
  setAppearance: (mode: 'light' | 'dark'): void => ipcRenderer.send('set-appearance', mode),
  // Clipboard for the terminal. xterm maps Ctrl+V to the ^V control code and
  // preventDefaults it, so the browser paste event never fires and there is no
  // native path to fall back on in a frameless window with no application menu.
  // Electron's own clipboard works regardless of secure-context rules, which
  // navigator.clipboard does not under file:// in a packaged build. Since
  // Electron 44 the module exists only in the main process, so both calls go
  // over IPC and resolve asynchronously.
  clipboardRead: (): Promise<string> => ipcRenderer.invoke('clipboard-read-text') as Promise<string>,
  clipboardWrite: (text: string): Promise<void> => ipcRenderer.invoke('clipboard-write-text', text) as Promise<void>,
  // Window controls for the frameless window on Windows and Linux, where no
  // native buttons are drawn over the renderer's titlebar.
  platform: process.platform,
  windowControl: (action: 'minimize' | 'maximize' | 'close'): void => ipcRenderer.send('window-control', action),
  onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: unknown, maximized: boolean): void => listener(maximized)
    ipcRenderer.on('window-maximized', handler)
    return () => ipcRenderer.removeListener('window-maximized', handler)
  },
})
