import type { TeamBase } from '../../../api/saved-agents.js'

export const BASE_AGENTS = ['claude', 'codex', 'opencode', 'gemini', 'cursor', 'hermes'] as const

/** A Claude team's members pin to Claude's model aliases. */
export const TEAM_MEMBER_MODELS = [
  { value: 'default', label: 'Inherit lead' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
]

/** The base CLIs that support a team (a lead that delegates to sub-agents). */
export const TEAM_BASES: { id: TeamBase; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'opencode', label: 'OpenCode' },
]
