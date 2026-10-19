import { describe, expect, it } from 'vitest'
import { composeRunPrompt } from './RunAgentModal.js'
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
