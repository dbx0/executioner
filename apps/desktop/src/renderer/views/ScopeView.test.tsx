import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'
import type { ScopeRule } from '../api/targets.js'

const rule = (over: Partial<ScopeRule> = {}): ScopeRule => ({
  id: 'r1',
  effect: 'include',
  pattern: '*.smartfit.com.br',
  note: '',
  source: 'agent',
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

const parse = vi.fn(() => Promise.resolve({ runId: 'run-1' }))
vi.mock('../api/scope.js', () => ({ scopeApi: () => ({ parse }) }))

const api = {
  scopeRules: vi.fn(() => Promise.resolve([rule()])),
  addScopeRule: vi.fn(() => Promise.resolve({ rule: rule({ id: 'r2' }), rejudged: 3, inScope: 2, outOfScope: 1 })),
  updateScopeRule: vi.fn(() => Promise.resolve({ rule: rule(), rejudged: 0 })),
  removeScopeRule: vi.fn(() => Promise.resolve({ ok: true, rejudged: 2, inScope: 1, outOfScope: 1 })),
}

vi.mock('../api/targets.js', () => ({ targetsApi: () => api }))

const { ScopeView } = await import('./ScopeView.js')

beforeEach(() => {
  vi.clearAllMocks()
  api.scopeRules.mockResolvedValue([rule()])
  api.addScopeRule.mockResolvedValue({ rule: rule({ id: 'r2' }), rejudged: 3, inScope: 2, outOfScope: 1 })
  api.removeScopeRule.mockResolvedValue({ ok: true, rejudged: 2, inScope: 1, outOfScope: 1 })
  useApp.setState({ client: {} as AxiosInstance, defaultAgent: 'claude', scopeRuns: {} })
})

/** Render, wait for the list, then open the add modal on the given tab. */
async function openAdd(tab: 'Manual' | 'Start with AI' = 'Manual'): Promise<void> {
  render(<ScopeView />)
  await screen.findByText('*.smartfit.com.br')
  fireEvent.click(screen.getByRole('button', { name: /add rule/i }))
  if (tab !== 'Manual') fireEvent.click(screen.getByRole('tab', { name: tab }))
}

const open = (): ReturnType<typeof render> => render(<ScopeView />)

const submit = (): void => {
  const buttons = screen.getAllByRole('button', { name: /add rule/i })
  fireEvent.click(buttons[buttons.length - 1] as HTMLElement)
}

describe('ScopeView', () => {
  it('lists the rules the engagement already has', async () => {
    open()
    expect(await screen.findByText('*.smartfit.com.br')).toBeTruthy()
  })

  it('adds an include rule from the modal', async () => {
    await openAdd()

    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'smartfit.com' } })
    submit()

    await waitFor(() =>
      expect(api.addScopeRule).toHaveBeenCalledWith(expect.objectContaining({ effect: 'include', pattern: 'smartfit.com' })),
    )
  })

  it('adds an exclusion with the reason typed beside it', async () => {
    await openAdd()

    fireEvent.click(screen.getByRole('button', { name: /exclude/i }))
    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'smartfit.io' } })
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'parked, not theirs' } })
    submit()

    await waitFor(() =>
      expect(api.addScopeRule).toHaveBeenCalledWith({
        effect: 'exclude',
        pattern: 'smartfit.io',
        note: 'parked, not theirs',
      }),
    )
  })

  it('reports how many targets the new rule re-judged', async () => {
    await openAdd()

    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'smartfit.com' } })
    submit()

    expect(await screen.findByText(/3 targets/i)).toBeTruthy()
  })

  it('shows the in and out of scope split after a manual add', async () => {
    await openAdd()

    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'smartfit.com' } })
    submit()

    expect(await screen.findByText('Re-judged 3 targets. 2 in scope, 1 out of scope.')).toBeTruthy()
  })

  it('says target in the singular for a single re-judged target', async () => {
    api.addScopeRule.mockResolvedValue({ rule: rule({ id: 'r2' }), rejudged: 1, inScope: 1, outOfScope: 0 })
    await openAdd()

    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'smartfit.com' } })
    submit()

    expect(await screen.findByText('Re-judged 1 target. 1 in scope, 0 out of scope.')).toBeTruthy()
  })

  it('does not mark the first load of rules as new, only a later arrival', async () => {
    const { container } = open()
    await screen.findByText('*.smartfit.com.br')
    expect(container.querySelectorAll('[data-new="true"]')).toHaveLength(0)

    api.scopeRules.mockResolvedValue([rule(), rule({ id: 'r2', pattern: 'new.example.com' })])
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }))
    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'new.example.com' } })
    submit()

    await screen.findByText('new.example.com')
    const fresh = container.querySelectorAll('[data-new="true"]')
    expect(fresh).toHaveLength(1)
    expect(fresh[0]?.textContent).toContain('new.example.com')
  })

  it('does not submit an empty pattern', async () => {
    await openAdd()

    submit()
    expect(api.addScopeRule).not.toHaveBeenCalled()
  })

  it('closes the modal once the rule lands', async () => {
    await openAdd()

    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'smartfit.com' } })
    submit()

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /add scope rule/i })).toBeNull())
  })

  it('hands a pasted scope to the AI parse instead of adding a rule', async () => {
    await openAdd('Start with AI')

    fireEvent.change(screen.getByLabelText(/^scope$/i), { target: { value: '*.smartfit.com.br\nout: shop.smartfit.com.br' } })
    fireEvent.click(screen.getByRole('button', { name: /parse with ai/i }))

    await waitFor(() =>
      expect(parse).toHaveBeenCalledWith(
        expect.objectContaining({ scope: '*.smartfit.com.br\nout: shop.smartfit.com.br' }),
      ),
    )
    expect(api.addScopeRule).not.toHaveBeenCalled()
    expect(await screen.findByText(/parsing scope/i)).toBeTruthy()
  })

  it('deletes a rule', async () => {
    open()
    await screen.findByText('*.smartfit.com.br')

    fireEvent.click(screen.getByRole('button', { name: /remove \*\.smartfit\.com\.br/i }))
    await waitFor(() => expect(api.removeScopeRule).toHaveBeenCalledWith('r1'))
  })

  it('counts the rules the AI pass wrote once the run reports done', async () => {
    await openAdd('Start with AI')

    fireEvent.change(screen.getByLabelText(/^scope$/i), { target: { value: '*.smartfit.com.br' } })
    fireEvent.click(screen.getByRole('button', { name: /parse with ai/i }))
    await waitFor(() => expect(parse).toHaveBeenCalled())

    // Three rules now where there was one: the agent wrote two.
    api.scopeRules.mockResolvedValue([rule(), rule({ id: 'r2' }), rule({ id: 'r3' })])
    await act(async () => {
      useApp.getState().handleAgentEvent('run-1', 'scope-done', { total: 4, added: 4, targets: [] })
    })

    expect(await screen.findByText(/2 rules added/i)).toBeTruthy()
    expect(screen.getByText(/4 targets recorded/i)).toBeTruthy()
  })

  it('surfaces a rejected rule instead of failing silently', async () => {
    api.addScopeRule.mockRejectedValueOnce(new Error('a rule already includes "smartfit.com"'))
    await openAdd()

    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: 'smartfit.com' } })
    submit()

    expect(await screen.findByText(/already includes/i)).toBeTruthy()
  })

  it('explains what an empty boundary means rather than showing a blank list', async () => {
    api.scopeRules.mockResolvedValueOnce([])
    open()
    expect(await screen.findByText(/no scope rules yet/i)).toBeTruthy()
  })

  it('heads the page with the rule count instead of a dialog chrome', async () => {
    open()
    await screen.findByText('*.smartfit.com.br')
    expect(screen.getByRole('heading', { name: 'Scope' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull()
  })

  it('keeps the add form behind a modal rather than on the page', async () => {
    open()
    await screen.findByText('*.smartfit.com.br')
    expect(screen.queryByLabelText(/pattern/i)).toBeNull()
  })
})
