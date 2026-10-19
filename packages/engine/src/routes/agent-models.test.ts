import { describe, expect, it } from 'vitest'
import { listAgentModels, parseModelLines, type ModelProbe } from './agent-models.js'

describe('agent-models', () => {
  it('parses model lines, dropping blanks/comments/garbage and de-duping', () => {
    const out = 'anthropic/claude-3-5-sonnet\n# a comment\n\nopenai/gpt-4o\nanthropic/claude-3-5-sonnet\nnot a model line'
    expect(parseModelLines(out)).toEqual(['anthropic/claude-3-5-sonnet', 'openai/gpt-4o'])
  })

  it('returns Claude aliases as a known set (no CLI call)', async () => {
    const probe: ModelProbe = () => Promise.reject(new Error('should not be called'))
    expect(await listAgentModels('claude', probe)).toEqual({ agent: 'claude', models: ['sonnet', 'opus', 'haiku'], source: 'known' })
  })

  it('lists opencode models from its CLI', async () => {
    const probe: ModelProbe = (program, args) =>
      program === 'opencode' && args[0] === 'models' ? Promise.resolve('anthropic/x\nopenai/y\n') : Promise.resolve(null)
    expect(await listAgentModels('opencode', probe)).toEqual({ agent: 'opencode', models: ['anthropic/x', 'openai/y'], source: 'cli' })
  })

  it('returns no models for agents that cannot be enumerated', async () => {
    const probe: ModelProbe = () => Promise.resolve(null)
    expect(await listAgentModels('gemini', probe)).toEqual({ agent: 'gemini', models: [], source: 'none' })
  })
})
