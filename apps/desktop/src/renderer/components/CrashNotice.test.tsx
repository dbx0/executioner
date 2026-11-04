import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrashNotice } from './CrashNotice.js'

const SESSION = { id: 'session-x', file: '/l/x', startedAt: '2026-11-02T08:00:00.000Z', pid: 1, live: false, crashed: true }

function stub(previousCrash: unknown, exportLogs = vi.fn(() => Promise.resolve({ saved: '/x.zip' }))): typeof exportLogs {
  Object.assign(window, { executioner: { log: { previousCrash: vi.fn(() => Promise.resolve(previousCrash)), exportLogs } } })
  return exportLogs
}

afterEach(cleanup)

describe('CrashNotice', () => {
  it('is absent when the last session ended cleanly', async () => {
    stub(null)
    render(<CrashNotice />)
    await Promise.resolve()
    expect(screen.queryByText('Executioner closed unexpectedly last time.')).toBeNull()
  })

  it('exports the crashed session', async () => {
    const exportLogs = stub(SESSION)
    render(<CrashNotice />)
    await screen.findByText('Executioner closed unexpectedly last time.')
    fireEvent.click(screen.getByRole('button', { name: 'Export logs' }))
    await waitFor(() =>
      expect(exportLogs).toHaveBeenCalledWith({ sessionId: 'session-x', includeTargets: false, includeAllSessions: false }),
    )
  })

  it('can be dismissed', async () => {
    stub(SESSION)
    render(<CrashNotice />)
    await screen.findByText('Executioner closed unexpectedly last time.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Executioner closed unexpectedly last time.')).toBeNull()
  })
})
