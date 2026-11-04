import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { OpenEngagement } from '../store/types.js'
import { CloseConfirm, closeMessage } from './CloseConfirm.js'

let fireConfirm: () => void
const bridge = {
  onConfirmClose: vi.fn((l: () => void) => {
    fireConfirm = l
    return () => {}
  }),
  closeConfirmShown: vi.fn(),
  answerClose: vi.fn(),
}

function engagement(agents: string[], running: number): OpenEngagement {
  const list = [
    ...Array.from({ length: running }, (_, i) => ({ id: `r${i}`, status: 'running' })),
    { id: 'done', status: 'succeeded' },
  ]
  const client = { get: vi.fn(() => Promise.resolve({ data: list })) } as unknown as AxiosInstance
  return {
    root: `/e/${agents.join('-')}`,
    sessions: agents.map((agent, i) => ({ id: `s${i}`, label: agent, agent })),
    client,
  } as unknown as OpenEngagement
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { executioner: bridge })
})
afterEach(() => {
  cleanup()
  useApp.setState({ open: [] })
})

describe('closeMessage', () => {
  it('reassures when nothing is running', () => {
    expect(closeMessage({ agents: 0, terminals: 0, runs: 0 })).toBe(
      'Your open engagements, tabs and unsaved editor changes come back the next time you open it.',
    )
  })

  it('lists what closing stops', () => {
    expect(closeMessage({ agents: 2, terminals: 1, runs: 1 })).toBe(
      '2 agents, 1 terminal and 1 run are still running. Closing Executioner stops them.',
    )
    expect(closeMessage({ agents: 1, terminals: 0, runs: 0 })).toBe(
      '1 agent is still running. Closing Executioner stops them.',
    )
  })
})

describe('CloseConfirm', () => {
  it('shows nothing until main asks', () => {
    render(<CloseConfirm />)
    expect(screen.queryByText('Close Executioner?')).toBeNull()
  })

  it('acknowledges, counts agents, terminals and runs, and confirms', async () => {
    useApp.setState({ open: [engagement(['claude', 'shell'], 1), engagement(['codex'], 0)] })
    render(<CloseConfirm />)
    act(() => fireConfirm())
    expect(bridge.closeConfirmShown).toHaveBeenCalledTimes(1)
    await screen.findByText('2 agents, 1 terminal and 1 run are still running. Closing Executioner stops them.')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(bridge.answerClose).toHaveBeenCalledWith(true)
    expect(screen.queryByText('Close Executioner?')).toBeNull()
  })

  it('cancel keeps the app open', () => {
    render(<CloseConfirm />)
    act(() => fireConfirm())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(bridge.answerClose).toHaveBeenCalledWith(false)
    expect(screen.queryByText('Close Executioner?')).toBeNull()
  })
})
