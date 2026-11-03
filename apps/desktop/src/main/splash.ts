import { readFileSync } from 'node:fs'
import { BrowserWindow } from 'electron'

/**
 * Startup splash: the cover art with a red progress bar along its bottom edge,
 * shown while the main window loads hidden behind it. The bar follows real
 * milestones (window created, page loaded, first paint) and creeps between
 * them, so it never sits still on a slow start.
 */

/** The cover's own aspect (1671x941), so the art is never cropped. */
const WIDTH = 720
const HEIGHT = Math.round((WIDTH * 941) / 1671)

/** Long enough to be seen on a fast start, never a wait on a slow one. */
const MIN_VISIBLE_MS = 1400
/** How long the bar takes to run out to 100% before the app appears. */
const FINISH_MS = 260

/** The splash page, self-contained: the image travels inline as a data URL. */
export function splashHtml(imageDataUrl: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; user-select: none; -webkit-app-region: drag; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .track { position: fixed; left: 0; right: 0; bottom: 0; height: 4px; background: rgb(120 0 8 / 0.45); }
  .fill { height: 100%; width: 0; background: #e40014; box-shadow: 0 0 12px 1px rgb(255 20 40 / 0.75); transition: width ${FINISH_MS}ms ease-out; }
</style></head>
<body>
<img src="${imageDataUrl}" alt="">
<div class="track"><div class="fill" id="fill"></div></div>
<script>
  // The target comes from the main process; between milestones the bar creeps
  // a little toward the next one so a slow step still looks alive.
  let target = 0, shown = 0
  const fill = document.getElementById('fill')
  window.setProgress = (p) => { target = Math.max(target, Math.min(1, p)) }
  setInterval(() => {
    const ceiling = target >= 1 ? 1 : Math.min(0.97, target + 0.12)
    shown = target >= 1 ? 1 : Math.max(shown, target) + (ceiling - Math.max(shown, target)) * 0.04
    fill.style.width = (shown * 100).toFixed(2) + '%'
  }, 60)
</script>
</body></html>`
}

export interface Splash {
  /** Move the bar to at least `p` (0 to 1). */
  progress(p: number): void
  /** Run the bar to 100% (after the minimum time on screen), call `reveal`, then close. */
  finish(reveal: () => void): Promise<void>
}

export function showSplash(imagePath: string): Splash {
  let image: string
  try {
    image = `data:image/jpeg;base64,${readFileSync(imagePath).toString('base64')}`
  } catch {
    // No art: the app still opens, it just skips the splash.
    return {
      progress: () => {},
      finish: (reveal) => {
        reveal()
        return Promise.resolve()
      },
    }
  }

  const shownAt = Date.now()
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    center: true,
    show: false,
    backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  void win.loadURL(`data:text/html;base64,${Buffer.from(splashHtml(image)).toString('base64')}`)

  // The latest target, sent again once the page is up: a milestone can land
  // before the splash itself has finished loading.
  let target = 0
  let loaded = false
  const send = (): void => {
    if (!loaded || win.isDestroyed()) return
    win.webContents.executeJavaScript(`window.setProgress?.(${target})`).catch(() => {})
  }
  win.webContents.once('did-finish-load', () => {
    loaded = true
    send()
  })
  const run = (p: number): void => {
    target = Math.max(target, Math.min(1, p))
    send()
  }
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)))

  return {
    progress: run,
    async finish(reveal) {
      await sleep(MIN_VISIBLE_MS - (Date.now() - shownAt))
      run(1)
      await sleep(FINISH_MS + 60)
      // The app shows before the splash goes, so there is never a moment with
      // no window on screen.
      reveal()
      if (!win.isDestroyed()) win.close()
    },
  }
}
