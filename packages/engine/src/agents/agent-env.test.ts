import { describe, expect, it } from 'vitest'
import { CLAUDE_SESSION_MARKERS } from './agent-env.js'

describe('CLAUDE_SESSION_MARKERS', () => {
  it('covers the marker that silently disables transcript saving', () => {
    // This is the one that matters most: a spawned claude that sees it believes
    // it is a nested child session and stops writing a transcript — which is
    // where the app reads each agent's resume id from, so the conversation
    // cannot be restored afterwards.
    expect(CLAUDE_SESSION_MARKERS).toContain('CLAUDE_CODE_CHILD_SESSION')
  })

  it('covers the other two conversation stamps', () => {
    expect(CLAUDE_SESSION_MARKERS).toContain('CLAUDE_CODE_SESSION_ID')
    expect(CLAUDE_SESSION_MARKERS).toContain('CLAUDE_CODE_BRIDGE_SESSION_ID')
  })

  it('leaves the "running inside Claude Code" signals alone', () => {
    // Stripping these made every spawned agent believe it was a top-level
    // session, so each one tried to claim things the outer session already
    // holds. They are true statements about the environment; only the
    // conversation stamps are wrong to inherit.
    expect(CLAUDE_SESSION_MARKERS).not.toContain('CLAUDECODE')
    expect(CLAUDE_SESSION_MARKERS).not.toContain('CLAUDE_CODE_ENTRYPOINT')
    expect(CLAUDE_SESSION_MARKERS).not.toContain('CLAUDE_CODE_EXECPATH')
  })

  it('stays narrow', () => {
    // A wide list is what caused the regression; keep it deliberate.
    expect(CLAUDE_SESSION_MARKERS).toHaveLength(3)
  })
})
