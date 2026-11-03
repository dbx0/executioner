import { existsSync } from 'node:fs'

const MAC_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
]

/**
 * Resolve a Chromium-based binary for host-owned windows.
 * Honors EXE_CHROME_PATH, then macOS app bundles.
 */
export function resolveChromePath(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromEnv = env.EXE_CHROME_PATH?.trim()
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) return fromEnv

  if (platform === 'darwin') {
    for (const path of MAC_CANDIDATES) {
      if (existsSync(path)) return path
    }
  }

  return null
}
