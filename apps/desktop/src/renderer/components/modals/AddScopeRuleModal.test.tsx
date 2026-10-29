import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../../store.js'

const parse = vi.fn(() => Promise.resolve({ runId: 'run-1' }))
const apply = vi.fn(() =>
  Promise.resolve({ rulesAdded: 2, targetsAdded: 1, rejudged: 3, inScope: 2, outOfScope: 1 }),
)
vi.mock('../../api/scope.js', () => ({ scopeApi: () => ({ parse, apply }) }))

const api = {
  scopeRules: vi.fn(() => Promise.resolve([])),
  addScopeRule: vi.fn(),
}
vi.mock('../../api/targets.js', () => ({ targetsApi: () => api }))

const { AddScopeRuleModal } = await import('./AddScopeRuleModal.js')

const PROPOSAL = {
  rules: [
    { effect: 'include' as const, pattern: '*.example.com', note: 'main app' },
    { effect: 'exclude' as const, pattern: 'shop.example.com' },
  ],
  targets: [{ kind: 'domain' as const, value: 'example.com' }],
}

const onClose = vi.fn()
const onApplied = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ client: {} as AxiosInstance, defaultAgent: 'claude', scopeRuns: {} })
})

/** Parse a paste and finish the run with the given scope-done payload. */
async function parseThenFinish(payload: Record<string, unknown>): Promise<void> {
  render(<AddScopeRuleModal onClose={onClose} onApplied={onApplied} />)
  fireEvent.click(screen.getByRole('tab', { name: 'Start with AI' }))
  fireEvent.change(screen.getByLabelText(/^scope$/i), { target: { value: '*.example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /parse with ai/i }))
  await waitFor(() => expect(parse).toHaveBeenCalledWith(expect.objectContaining({ propose: true })))
  await screen.findByText(/parsing scope/i)
  await act(async () => {
    useApp.getState().handleAgentEvent('run-1', 'scope-done', payload)
  })
}

describe('AddScopeRuleModal review step', () => {
  it('shows proposed rules and applies them on Add', async () => {
    await parseThenFinish({ total: 1, added: 0, targets: PROPOSAL.targets, proposal: PROPOSAL })

    expect(await screen.findByText('*.example.com')).toBeTruthy()
    expect(screen.getByText('main app')).toBeTruthy()
    expect(screen.getByText('shop.example.com')).toBeTruthy()
    expect(screen.getByText(/1 target/i)).toBeTruthy()
    expect(apply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(apply).toHaveBeenCalledWith(PROPOSAL))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ rejudged: 3, inScope: 2, outOfScope: 1 }))
    expect(await screen.findByText(/2 rules added/i)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancel on review writes nothing', async () => {
    await parseThenFinish({ total: 1, added: 0, targets: PROPOSAL.targets, proposal: PROPOSAL })
    await screen.findByText('*.example.com')

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(apply).not.toHaveBeenCalled()
    expect(onApplied).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers only Close when the agent found no rules', async () => {
    await parseThenFinish({ total: 0, added: 0, targets: [], proposal: { rules: [], targets: [] } })

    expect(await screen.findByText("The agent didn't find any rules in that text.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^add$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^close$/i }).length).toBeGreaterThan(0)
    expect(apply).not.toHaveBeenCalled()
  })
})
