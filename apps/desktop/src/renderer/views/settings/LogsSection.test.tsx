import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogLine } from '@exe/protocol'
import { LogsSection } from './LogsSection.js'

const line = (over: Partial<LogLine> = {}): LogLine => ({
  t: '2026-11-03T10:00:00.000Z',
  lvl: 'info',
  src: 'main',
  msg: 'hello',
  ...over,
})

const OTHER = { id: 'session-other', file: '/l/other', startedAt: '2026-11-03T09:00:00.000Z', pid: 3, live: true, crashed: false }
const OLD = { id: 'session-old', file: '/l/old', startedAt: '2026-11-02T08:00:00.000Z', pid: 1, live: false, crashed: true }
const CUR = { id: 'session-cur', file: '/l/cur', startedAt: '2026-11-03T08:00:00.000Z', pid: 2, live: true, crashed: false }

let log: Record<string, ReturnType<typeof vi.fn>> & { read: ReturnType<typeof vi.fn> }
let contents: Record<string, LogLine[]>

beforeEach(() => {
  contents = {
    'session-cur': [
      line({ msg: 'booted' }),
      line({ lvl: 'debug', msg: 'noisy detail', src: 'renderer/ipc' }),
      line({ lvl: 'error', msg: 'it broke', src: 'engine:a1b2', data: { code: 7 } }),
    ],
    'session-old': [line({ msg: 'older run' })],
  }
  log = {
    sessions: vi.fn(() => Promise.resolve([OLD, CUR, OTHER])),
    currentSession: vi.fn(() => Promise.resolve(CUR)),
    read: vi.fn(({ id }: { id: string }) => Promise.resolve(contents[id] ?? [])),
    getVerbose: vi.fn(() => Promise.resolve(false)),
    setVerbose: vi.fn(() => Promise.resolve()),
    openFolder: vi.fn(() => Promise.resolve('')),
    exportLogs: vi.fn(() => Promise.resolve({ saved: '/x.zip' })),
    onLevel: vi.fn(() => () => {}),
  }
  Object.assign(window, {
    executioner: { log, clipboardWrite: vi.fn(() => Promise.resolve()) },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function mount(): Promise<void> {
  render(<LogsSection />)
  await screen.findByText('booted')
}

// Radix Select scrolls and captures the pointer, which jsdom does not implement.
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

describe('LogsSection', () => {
  it('lists the current session and always reads with a limit', async () => {
    await mount()
    expect(screen.getByText('it broke')).toBeTruthy()
    expect(log.read).toHaveBeenCalledWith({ id: 'session-cur', limit: 2000 })
  })

  it('shows this instance session, not a newer live one from another instance', async () => {
    await mount()
    expect(log.read).toHaveBeenCalledWith({ id: 'session-cur', limit: 2000 })
    expect(log.read).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'session-other' }))
  })

  it('polls every second and appends only new lines', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await mount()
    contents['session-cur'] = [...contents['session-cur']!, line({ msg: 'fresh line' })]
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getAllByText('fresh line')).toHaveLength(1)
    expect(screen.getAllByText('booted')).toHaveLength(1)
    expect(log.read.mock.calls.every((c) => (c[0] as { limit?: number }).limit === 2000)).toBe(true)
  })

  it('hides debug lines when the debug level is unchecked', async () => {
    await mount()
    expect(screen.getByText('noisy detail')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'debug' }))
    expect(screen.queryByText('noisy detail')).toBeNull()
  })

  it('offers main, renderer and each engine as sources and filters by them', async () => {
    await mount()
    for (const name of ['main', 'renderer', 'engine:a1b2']) {
      expect(screen.getByRole('checkbox', { name })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'engine:a1b2' }))
    expect(screen.queryByText('it broke')).toBeNull()
    expect(screen.getByText('booted')).toBeTruthy()
  })

  it('expands a line to show its data as formatted JSON', async () => {
    await mount()
    expect(screen.queryByText(/"code": 7/)).toBeNull()
    fireEvent.click(screen.getByText('it broke'))
    expect(screen.getByText(/"code": 7/)).toBeTruthy()
  })

  it('turns verbose logging on and says so', async () => {
    await mount()
    expect(screen.queryByText(/Verbose logging is on/)).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Verbose logging' }))
    expect(log.setVerbose).toHaveBeenCalledWith(true)
    await screen.findByText('Verbose logging is on. Turn it off when you are done reproducing the problem.')
  })

  it('exports with the dialog flags, both off by default', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    const dialog = screen.getByRole('dialog')
    const targets = within(dialog).getByRole('checkbox', { name: 'Include target details' }) as HTMLInputElement
    const all = within(dialog).getByRole('checkbox', { name: 'Include all recent sessions' }) as HTMLInputElement
    expect(targets.checked).toBe(false)
    expect(all.checked).toBe(false)
    expect(within(dialog).getByText('Also includes crash dumps, which can contain unscrubbed data. Only send this privately.')).toBeTruthy()
    fireEvent.click(targets)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() =>
      expect(log.exportLogs).toHaveBeenCalledWith({ includeAllSessions: false, includeTargets: true }),
    )
  })

  it('copies the visible lines and opens the logs folder', async () => {
    await mount()
    fireEvent.click(screen.getByRole('checkbox', { name: 'debug' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    const write = (window.executioner as unknown as { clipboardWrite: ReturnType<typeof vi.fn> }).clipboardWrite
    await waitFor(() => expect(write).toHaveBeenCalled())
    const text = write.mock.calls[0]![0] as string
    expect(text).toContain('booted')
    expect(text).toContain('it broke')
    expect(text).not.toContain('noisy detail')
    fireEvent.click(screen.getByRole('button', { name: 'Open logs folder' }))
    expect(log.openFolder).toHaveBeenCalled()
  })

  it('loads an older session read-only and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await mount()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Session' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: /closed unexpectedly/ }))
    await screen.findByText('older run')
    expect(screen.queryByText('booted')).toBeNull()
    expect(log.read).toHaveBeenCalledWith({ id: 'session-old', limit: 2000 })
    const calls = log.read.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(log.read.mock.calls.length).toBe(calls)
  })
})
