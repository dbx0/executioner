import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../../store.js'

const TARGETS = [
  { id: 't1', kind: 'domain', value: 'a.com' },
  { id: 't2', kind: 'domain', value: 'b.com' },
  { id: 't3', kind: 'ip', value: '1.2.3.4' },
]
vi.mock('../../api/targets.js', () => ({ targetsApi: () => ({ list: () => Promise.resolve(TARGETS) }) }))
vi.mock('../../api/backends.js', () => ({ backendsApi: () => ({ list: () => Promise.resolve([]) }) }))

const { RunAgentModal } = await import('./RunAgentModal.js')

const createSession = vi.fn(() => Promise.resolve())
const AGENT = { name: 'Recon', agent: 'claude', prompt: 'You are a recon specialist.' }

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ client: {} as AxiosInstance, createSession })
})

/** Pick targets through the search box, the way an operator does. */
async function pick(...values: string[]): Promise<void> {
  const search = await screen.findByPlaceholderText(/search 3 targets/i)
  for (const value of values) {
    fireEvent.focus(search)
    fireEvent.mouseDown(await screen.findByText(value))
  }
}

const prompts = (): string[] => createSession.mock.calls.map((call) => (call as unknown as [{ prompt: string }])[0].prompt)

describe('RunAgentModal, one session per target', () => {
  it('starts one session for all the targets by default', async () => {
    render(<RunAgentModal agent={AGENT} onClose={() => {}} />)
    await pick('a.com', 'b.com', '1.2.3.4')
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }))
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(prompts()[0]).toContain('- a.com (domain)')
    expect(prompts()[0]).toContain('- 1.2.3.4 (ip)')
  })

  it('starts a session for each target when the switch is on', async () => {
    render(<RunAgentModal agent={AGENT} onClose={() => {}} />)
    await pick('a.com', 'b.com', '1.2.3.4')
    fireEvent.click(screen.getByRole('switch', { name: /one session per target/i }))
    fireEvent.click(screen.getByRole('button', { name: /run 3 sessions/i }))
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(3))
    expect(prompts().map((p) => p.match(/- (\S+) \(/)?.[1])).toEqual(['a.com', 'b.com', '1.2.3.4'])
    for (const call of createSession.mock.calls) expect((call as unknown as [{ agent: string }])[0].agent).toBe('claude')
  })

  it('does not offer the switch until there is more than one target to split over', async () => {
    render(<RunAgentModal agent={AGENT} onClose={() => {}} />)
    await pick('a.com')
    expect(screen.queryByRole('switch', { name: /one session per target/i })).toBeNull()
  })
})

describe('RunAgentModal, choosing the agent', () => {
  const CHOICES = [
    { name: 'Claude', agent: 'claude', prompt: '' },
    { name: 'Recon', agent: 'claude', prompt: 'You are a recon specialist.' },
  ]

  it('asks which agent to run when none was chosen beforehand, and will not run without one', () => {
    render(<RunAgentModal choices={CHOICES} onClose={() => {}} />)
    expect(screen.getByText('Run an agent')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /agent/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^run$/i })).toHaveProperty('disabled', true)
  })

  it('names the agent in the header when one was chosen beforehand, with nothing to pick', () => {
    render(<RunAgentModal agent={AGENT} onClose={() => {}} />)
    expect(screen.getByText(/Run .Recon./)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /agent/i })).toBeNull()
  })
})
