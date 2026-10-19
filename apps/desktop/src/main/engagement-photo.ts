import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The engagement metadata directory, mirroring `@exe/project`'s `layout`. It is
 * duplicated rather than imported because that package pulls in `@exe/db` (and
 * with it better-sqlite3), which must not be loaded into the Electron main
 * process — its native ABI belongs to the engine.
 */
const DOT_DIR = '.executioner'

/** Where an engagement's photo badge lives on disk. Always a PNG: whatever the
 *  user picked is re-encoded on import, so the extension never lies. */
export function photoPath(root: string): string {
  return join(root, DOT_DIR, 'icon.png')
}

/** The data-URL prefix a stored badge is written back as. */
const PNG_DATA_URL = 'data:image/png;base64,'

/** Decode a `data:image/png;base64,…` URL into bytes, or null if it isn't one. */
export function decodePngDataUrl(dataUrl: string): Buffer | null {
  if (!dataUrl.startsWith(PNG_DATA_URL)) return null
  try {
    const buffer = Buffer.from(dataUrl.slice(PNG_DATA_URL.length), 'base64')
    return buffer.byteLength === 0 ? null : buffer
  } catch {
    return null
  }
}

/** Write an engagement's photo badge, creating `.executioner/` if the folder is
 *  new. Returns false when the data URL isn't a PNG we produced. */
export function writePhoto(root: string, dataUrl: string): boolean {
  const bytes = decodePngDataUrl(dataUrl)
  if (bytes === null) return false
  mkdirSync(join(root, DOT_DIR), { recursive: true })
  writeFileSync(photoPath(root), bytes)
  return true
}

/** Remove an engagement's photo badge. A missing file is already the goal. */
export function removePhoto(root: string): void {
  try {
    rmSync(photoPath(root), { force: true })
  } catch {
    /* nothing to remove, or the folder is gone */
  }
}

export function hasPhoto(root: string): boolean {
  try {
    return existsSync(photoPath(root))
  } catch {
    return false
  }
}
