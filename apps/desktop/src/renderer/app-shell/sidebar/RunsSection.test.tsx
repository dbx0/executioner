import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../../store.js'
import type { ExecutionSummary } from '../../api/executions.js'

const runs: ExecutionSummary[] = [
  { id: 'abcdef1234', status: 'running' } as ExecutionSummary,
  { id: 'beefcafe99', status: 'succeeded' } as ExecutionSummary,
]

const fakeApi = { list: vi.fn(() => Promise.resolve(runs)) }
vi.mock('../../api/executions.js', () => ({ executionsApi: () => fakeApi }))

const { RunsSection } = await import('./RunsSection.js')

describe('RunsSection', () => {
  beforeEach(() => {
    useApp.setState({ client: {} as AxiosInstance })
  })

  it('starts collapsed so a long run list never pushes the sidebar around', async () => {
    render(<RunsSection />)
    const toggle = await screen.findByRole('button', { name: /runs/i })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('abcdef12')).toBeNull()
  })

  it('reveals the runs when the heading is clicked', async () => {
    render(<RunsSection />)
    fireEvent.click(await screen.findByRole('button', { name: /runs/i }))

    await waitFor(() => expect(screen.getByText('abcdef12')).toBeTruthy())
    expect(screen.getByText('beefcafe')).toBeTruthy()
  })
})
