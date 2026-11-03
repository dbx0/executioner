import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const DOT_DIR = '.executioner'
const PHOTO_SIZE = 128
const PNG_DATA_URL = 'data:image/png;base64,'

export function photoPath(root: string): string {
  return join(root, DOT_DIR, 'icon.png')
}

export function decodePngDataUrl(dataUrl: string): Buffer | null {
  if (!dataUrl.startsWith(PNG_DATA_URL)) return null
  try {
    const buffer = Buffer.from(dataUrl.slice(PNG_DATA_URL.length), 'base64')
    return buffer.byteLength === 0 ? null : buffer
  } catch {
    return null
  }
}

export function writePhoto(root: string, dataUrl: string): boolean {
  const bytes = decodePngDataUrl(dataUrl)
  if (bytes === null) return false
  mkdirSync(join(root, DOT_DIR), { recursive: true })
  writeFileSync(photoPath(root), bytes)
  return true
}

export function removePhoto(root: string): void {
  try {
    rmSync(photoPath(root), { force: true })
  } catch {
    /* already gone */
  }
}

export function hasPhoto(root: string): boolean {
  try {
    return existsSync(photoPath(root))
  } catch {
    return false
  }
}

export function isEngagementRoot(root: unknown): root is string {
  if (typeof root !== 'string' || root === '' || !isAbsolute(root)) return false
  try {
    return statSync(root).isDirectory()
  } catch {
    return false
  }
}

export type SipsEncoder = (sourcePath: string, destPath: string) => Promise<void>

function defaultSips(sourcePath: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/sips',
      ['-z', String(PHOTO_SIZE), String(PHOTO_SIZE), '-s', 'format', 'png', sourcePath, '--out', destPath],
      { timeout: 30_000 },
      (err, _stdout, stderr) => {
        if (err !== null) reject(new Error(stderr.trim() || err.message))
        else resolve()
      },
    )
  })
}

/** Re-encode an image to a 128×128 PNG data URL with sips. */
export async function encodeImageToPngDataUrl(
  sourcePath: string,
  encode: SipsEncoder = defaultSips,
): Promise<string | null> {
  if (!existsSync(sourcePath)) return null
  const dir = mkdtempSync(join(tmpdir(), 'exe-photo-'))
  const dest = join(dir, 'icon.png')
  try {
    await encode(sourcePath, dest)
    if (!existsSync(dest)) return null
    const bytes = readFileSync(dest)
    if (bytes.byteLength === 0) return null
    return `${PNG_DATA_URL}${bytes.toString('base64')}`
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
