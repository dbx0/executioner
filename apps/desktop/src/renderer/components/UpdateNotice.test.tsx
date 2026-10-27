import { fireEvent, render, screen } from '@testing-library/react'
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

  it('installs in place when this copy can update itself', async () => {
    const installUpdate = vi.fn(() => new Promise<void>(() => {}))
    stub({ checkForUpdate: vi.fn(() => Promise.resolve(update)), installUpdate })
    render(<UpdateNotice />)

    expect(await screen.findByText('Executioner 0.0.3 is out')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    expect(installUpdate).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Updating...' })).toHaveProperty('disabled', true)
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
