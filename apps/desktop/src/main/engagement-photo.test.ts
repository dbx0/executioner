import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createIpcHandlers } from './ipc.js'
import { decodePngDataUrl, hasPhoto, photoPath, removePhoto, writePhoto } from './engagement-photo.js'

const PNG = `data:image/png;base64,${Buffer.from('not-really-a-png').toString('base64')}`

function root(): string {
  return mkdtempSync(join(tmpdir(), 'exe-photo-'))
}

describe('engagement photo storage', () => {
  it('writes the badge inside the engagement folder', () => {
    const dir = root()
    expect(writePhoto(dir, PNG)).toBe(true)
    expect(photoPath(dir)).toBe(join(dir, '.executioner', 'icon.png'))
    expect(readFileSync(photoPath(dir)).toString()).toBe('not-really-a-png')
    expect(hasPhoto(dir)).toBe(true)
  })

  it('refuses anything that is not a PNG data URL', () => {
    const dir = root()
    expect(writePhoto(dir, 'data:image/jpeg;base64,AAAA')).toBe(false)
    expect(writePhoto(dir, 'https://example.com/photo.png')).toBe(false)
    expect(decodePngDataUrl('data:image/png;base64,')).toBeNull()
    expect(hasPhoto(dir)).toBe(false)
  })

  it('removing a badge that was never there is not an error', () => {
    const dir = root()
    removePhoto(dir)
    writePhoto(dir, PNG)
    removePhoto(dir)
    expect(hasPhoto(dir)).toBe(false)
  })
})

function handlers(encodeImage: (path: string) => string | null, pickImage = async (): Promise<string | undefined> => undefined) {
  return createIpcHandlers({
    supervisor: { start: vi.fn(), stop: vi.fn(), current: vi.fn(() => undefined) } as never,
    pickFolder: async () => undefined,
    initProject: vi.fn(async () => {}),
    probeAgent: vi.fn(async () => true),
    runEngineJson: vi.fn(async () => ({})),
    sshKeyDir: () => '/tmp/ssh',
    connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
    pickImage,
    encodeImage,
  })
}

describe('photo ipc handlers', () => {
  it('reads nothing back from an engagement with no badge', async () => {
    const encodeImage = vi.fn(() => PNG)
    const result = await handlers(encodeImage).readEngagementPhoto({ root: root() })
    expect(result).toBeNull()
    // No file, so the image decoder is never asked about a path that isn't there.
    expect(encodeImage).not.toHaveBeenCalled()
  })

  it('reads a stored badge back through the image decoder', async () => {
    const dir = root()
    mkdirSync(join(dir, '.executioner'), { recursive: true })
    writeFileSync(photoPath(dir), 'bytes')
    const encodeImage = vi.fn(() => PNG)

    expect(await handlers(encodeImage).readEngagementPhoto({ root: dir })).toBe(PNG)
    expect(encodeImage).toHaveBeenCalledWith(photoPath(dir))
  })

  it('returns what actually landed on disk when a badge is stored', async () => {
    const dir = root()
    const result = await handlers(() => PNG).writeEngagementPhoto({ root: dir, dataUrl: PNG })
    expect(result).toBe(PNG)
    expect(hasPhoto(dir)).toBe(true)
  })

  it('stores nothing when the data URL is not one we produced', async () => {
    const dir = root()
    const result = await handlers(() => PNG).writeEngagementPhoto({ root: dir, dataUrl: 'file:///etc/passwd' })
    expect(result).toBeNull()
    expect(hasPhoto(dir)).toBe(false)
  })

  it('picking a file that is not a readable image yields no badge', async () => {
    const result = await handlers(() => null, async () => '/tmp/notes.txt').pickEngagementPhoto()
    expect(result).toBeNull()
  })
})
