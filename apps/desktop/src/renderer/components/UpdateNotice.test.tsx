import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateNotice } from './UpdateNotice.js'

const update = {
  current: '0.0.2',
  latest: '0.0.3',
  tag: 'v0.0.3',
  url: 'https://github.com/dbx0/executioner/releases/tag/v0.0.3',
  canInstall: true,
}

function stub(api: Record<string, unknown>): void {
  vi.stubGlobal('window', Object.assign(window, { executioner: api }))
}

afterEach(() => vi.restoreAllMocks())

describe('UpdateNotice', () => {
  it('stays hidden when there is no newer release', async () => {
    stub({ checkForUpdate: vi.fn(() => Promise.resolve(null)) })
    render(<UpdateNotice />)
    await Promise.resolve()
    expect(screen.queryByRole('dialog', { name: 'Update available' })).toBeNull()
  })

  it('downloads with progress, then restarts to install', async () => {
    let progress: (p: { received: number; total: number | null }) => void = () => {}
    let finish: () => void = () => {}
    const downloadUpdate = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const installUpdate = vi.fn(() => new Promise<void>(() => {}))
    stub({
      checkForUpdate: vi.fn(() => Promise.resolve(update)),
      downloadUpdate,
      onUpdateProgress: vi.fn((listener: typeof progress) => {
        progress = listener
        return () => {}
      }),
      installUpdate,
    })
    render(<UpdateNotice />)

    expect(await screen.findByText('Executioner 0.0.3 is out')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Downloading...' })).toHaveProperty('disabled', true)
    act(() => progress({ received: 50 * 1024 * 1024, total: 100 * 1024 * 1024 }))
    expect(screen.getByRole('progressbar', { name: 'Update download' }).getAttribute('aria-valuenow')).toBe('50')
    expect(screen.getByText('50.0 MB of 100.0 MB (50%)')).toBeTruthy()
    expect(installUpdate).not.toHaveBeenCalled()

    await act(async () => finish())
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }))

    expect(installUpdate).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Restarting...' })).toHaveProperty('disabled', true)
  })

  it('offers the update again when the download fails', async () => {
    stub({
      checkForUpdate: vi.fn(() => Promise.resolve(update)),
      downloadUpdate: vi.fn(() => Promise.reject(new Error('offline'))),
      onUpdateProgress: vi.fn(() => () => {}),
    })
    render(<UpdateNotice />)

    fireEvent.click(await screen.findByRole('button', { name: 'Update' }))

    expect(await screen.findByText(/The download failed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toHaveProperty('disabled', false)
  })

  it('opens the release page when it cannot install in place', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const installUpdate = vi.fn()
    stub({ checkForUpdate: vi.fn(() => Promise.resolve({ ...update, canInstall: false })), installUpdate })
    render(<UpdateNotice />)

    fireEvent.click(await screen.findByRole('button', { name: 'Update' }))

    expect(open).toHaveBeenCalledWith(update.url, '_blank')
    expect(installUpdate).not.toHaveBeenCalled()
  })

  it('goes away when dismissed', async () => {
    stub({ checkForUpdate: vi.fn(() => Promise.resolve(update)) })
    render(<UpdateNotice />)

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('dialog', { name: 'Update available' })).toBeNull()
  })
})
