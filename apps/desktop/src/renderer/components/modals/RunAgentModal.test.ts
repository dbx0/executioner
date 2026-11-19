import { describe, expect, it } from 'vitest'
import { composeRunPrompt, runnableChoices, runPrompts } from './RunAgentModal.js'
import type { SavedAgent } from '../../api/saved-agents.js'

const agent: SavedAgent = {
  id: 'a1',
  name: 'Recon',
  description: 'recon',
  agent: 'claude',
  prompt: 'You are a recon specialist.',
  scope: 'global',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('composeRunPrompt', () => {
  it('includes the prompt and the targets', () => {
    const out = composeRunPrompt(agent, [{ value: 'a.com', kind: 'domain' }, { value: '1.2.3.4', kind: 'ip' }], 'local')
    expect(out).toContain('You are a recon specialist.')
    expect(out).toContain('Targets:')
    expect(out).toContain('- a.com (domain)')
    expect(out).toContain('- 1.2.3.4 (ip)')
    // Local backend adds no routing instruction.
    expect(out).not.toContain('run_command')
  })

  it('appends backend routing instructions when not local', () => {
    const out = composeRunPrompt(agent, [{ value: 'a.com', kind: 'domain' }], 'backend-9')
    expect(out).toContain('run_command')
    expect(out).toContain('backend "backend-9"')
  })

  it('omits the Targets block when there are none', () => {
    const out = composeRunPrompt(agent, [], 'local')
    expect(out).not.toContain('Targets:')
    expect(out).toBe('You are a recon specialist.')
  })
})

describe('runPrompts', () => {
  const targets = [
    { value: 'a.com', kind: 'domain' },
    { value: 'b.com', kind: 'domain' },
    { value: '1.2.3.4', kind: 'ip' },
  ]

  it('is one prompt naming every target when the run is shared', () => {
    const prompts = runPrompts(agent, targets, 'local', false)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('- a.com (domain)')
    expect(prompts[0]).toContain('- 1.2.3.4 (ip)')
  })

  it('is one prompt per target, each naming only its own, when spawning one per target', () => {
    const prompts = runPrompts(agent, targets, 'backend-9', true)
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).toContain('- b.com (domain)')
    expect(prompts[1]).not.toContain('a.com')
    expect(prompts[1]).not.toContain('1.2.3.4')
    // Every session keeps the agent's own prompt and the backend routing.
    for (const prompt of prompts) {
      expect(prompt).toContain('You are a recon specialist.')
      expect(prompt).toContain('backend "backend-9"')
    }
  })

  it('still starts a single session when there is nothing to split over', () => {
    expect(runPrompts(agent, [], 'local', true)).toEqual(['You are a recon specialist.'])
    expect(runPrompts(agent, [targets[0]!], 'local', true)).toHaveLength(1)
  })
})

describe('runnableChoices', () => {
  const saved = [{ name: 'Recon', agent: 'claude', prompt: 'recon prompt' }]
  const teams = [
    { id: 't1', name: 'Recon & Strike', description: '', members: [] },
    { id: 't2', name: 'Recon', description: '', members: [] },
  ]

  it('lists the installed CLIs, then the saved agents, then the teams', () => {
    const choices = runnableChoices({ installed: ['claude', 'codex'], saved, teams })
    expect(choices.map((c) => [c.name, c.agent])).toEqual([
      ['Claude', 'claude'],
      ['Codex', 'codex'],
      ['Recon', 'claude'],
      // The team called Recon is already there as a saved agent of that name.
      ['Recon & Strike', 'claude-team:t1'],
    ])
    expect(choices[2]?.prompt).toBe('recon prompt')
  })

  it('offers every CLI until the installed check has answered', () => {
    expect(runnableChoices({ installed: null, saved: [], teams: [] }).map((c) => c.agent)).toEqual([
      'claude', 'codex', 'opencode', 'gemini', 'cursor', 'hermes',
    ])
  })

  it('leaves the teams out when Claude is not installed to run them', () => {
    const choices = runnableChoices({ installed: ['codex'], saved: [], teams })
    expect(choices.map((c) => c.name)).toEqual(['Codex'])
  })
})

