import { describe, expect, it, vi } from 'vitest'
import { DARWIN_REQUIRED, chooseFolder, chooseImage } from './mac-dialogs.js'

describe('chooseFolder', () => {
  it('returns the chosen path without a trailing slash', async () => {
    const run = vi.fn(async () => '/Users/op/eng/')
    await expect(chooseFolder({ platform: 'darwin', runOsascript: run })).resolves.toBe('/Users/op/eng')
    expect(run).toHaveBeenCalledOnce()
  })

  it('returns null when the dialog is cancelled', async () => {
    const run = vi.fn(async () => null)
    await expect(chooseFolder({ platform: 'darwin', runOsascript: run })).resolves.toBeNull()
  })

  it('refuses non-Darwin platforms', async () => {
    await expect(chooseFolder({ platform: 'linux' })).rejects.toThrow(DARWIN_REQUIRED)
  })
})

describe('chooseImage', () => {
  it('returns the chosen file path', async () => {
    const run = vi.fn(async () => '/tmp/badge.png')
    await expect(chooseImage({ platform: 'darwin', runOsascript: run })).resolves.toBe('/tmp/badge.png')
  })

  it('returns null when cancelled', async () => {
    await expect(chooseImage({ platform: 'darwin', runOsascript: async () => null })).resolves.toBeNull()
  })

  it('refuses non-Darwin platforms', async () => {
    await expect(chooseImage({ platform: 'win32' })).rejects.toThrow(DARWIN_REQUIRED)
  })
})
