import { execFile } from 'node:child_process'

export const DARWIN_REQUIRED = 'Native dialogs require macOS (Darwin)'

/** Run an AppleScript snippet; null means the operator cancelled. */
export type OsascriptRunner = (source: string) => Promise<string | null>

function defaultOsascript(source: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', source], { timeout: 600_000 }, (err, stdout, stderr) => {
      if (err !== null) {
        const msg = `${stderr}\n${err.message}`.toLowerCase()
        if (msg.includes('user canceled') || msg.includes('user cancelled')) {
          resolve(null)
          return
        }
        const status = (err as NodeJS.ErrnoException & { status?: number }).status
        // choose folder/file exits 1 on cancel when stderr is empty in some macOS versions.
        if (status === 1) {
          resolve(null)
          return
        }
        reject(new Error(stderr.trim() || err.message))
        return
      }
      const path = stdout.trim()
      resolve(path === '' ? null : path)
    })
  })
}

export interface MacDialogOptions {
  platform?: NodeJS.Platform
  runOsascript?: OsascriptRunner
}

function assertDarwin(platform: NodeJS.Platform): void {
  if (platform !== 'darwin') throw new Error(DARWIN_REQUIRED)
}

/** Native folder chooser. Returns the absolute path, or null when cancelled. */
export async function chooseFolder(options: MacDialogOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform
  assertDarwin(platform)
  const run = options.runOsascript ?? defaultOsascript
  const raw = await run('POSIX path of (choose folder with prompt "Open engagement")')
  if (raw === null) return null
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

/** Native image file chooser for engagement photo import. */
export async function chooseImage(options: MacDialogOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform
  assertDarwin(platform)
  const run = options.runOsascript ?? defaultOsascript
  return run(
    'POSIX path of (choose file of type {"public.png", "public.jpeg", "public.tiff", "public.heic", "com.compuserve.gif", "org.webmproject.webp"} with prompt "Choose engagement photo")',
  )
}
