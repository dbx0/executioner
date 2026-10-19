import type { JSX } from 'react'
import { ClaudeLogo } from './ClaudeLogo.js'
import { CodexLogo } from './CodexLogo.js'
import { CursorLogo } from './CursorLogo.js'
import { GeminiLogo } from './GeminiLogo.js'
import { HermesLogo } from './HermesLogo.js'
import { OpenCodeLogo } from './OpenCodeLogo.js'

/**
 * Picks the brand mark for an agent type. Claude and Claude Team share the
 * Claude mark (same provider); Codex uses the OpenAI mark; OpenCode, Gemini,
 * Cursor, and Hermes each use their own brand mark. Anything else falls back to
 * the Claude mark so an agent row always renders a glyph. Marks size (and, where
 * they use `currentColor`, color) via `className`.
 */
export function AgentIcon({ agent, className }: { agent: string; className?: string }): JSX.Element {
  // A team launches its base CLI, so it wears that CLI's mark (`opencode-team:x`
  // → OpenCode, `claude-team:x` → Claude).
  const base = agent.startsWith('opencode-team') ? 'opencode' : agent.startsWith('claude-team') ? 'claude' : agent
  const Mark =
    base === 'codex'
      ? CodexLogo
      : base === 'opencode'
        ? OpenCodeLogo
        : base === 'gemini'
          ? GeminiLogo
          : base === 'cursor'
            ? CursorLogo
            : base === 'hermes'
              ? HermesLogo
              : ClaudeLogo
  return <Mark {...(className === undefined ? {} : { className })} />
}
