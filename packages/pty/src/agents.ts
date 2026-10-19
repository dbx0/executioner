export interface AgentInvocation {
  prompt: string
  headless: boolean
  /**
   * When set (interactive launches only), resume the agent's prior conversation
   * by its own session id instead of starting blank. For claude this is the
   * session UUID carried in its transcript filename; the id is verified against
   * the CLI's `--resume <id>` flag (see agents.test.ts).
   */
  resume?: string
}

export interface AgentAdapter {
  /** Builds the argv to spawn the agent CLI. */
  buildArgv(invocation: AgentInvocation): string[]
}

/**
 * Adapters for the agent CLIs the ADE spawns. Each is intentionally small: the
 * agent handles its own auth and its own TUI; the ADE only needs to launch it
 * with a prompt and, in headless mode, run to completion.
 */
export const agentAdapters: Record<string, AgentAdapter> = {
  claude: {
    // Interactive mode must launch with no prompt argument (an empty string
    // would be read as an empty prompt and the TUI would not start). A resume id
    // reopens the prior conversation (`claude --resume <id>`); resume is never
    // combined with headless (-p) runs, which are one-shot.
    buildArgv: ({ prompt, headless, resume }) =>
      headless
        ? ['claude', '-p', prompt]
        : resume !== undefined && resume !== ''
          ? ['claude', '--resume', resume]
          : prompt === ''
            ? ['claude']
            : ['claude', prompt],
  },
  codex: {
    // codex resumes by id with the `resume` subcommand.
    buildArgv: ({ prompt, headless, resume }) =>
      headless
        ? ['codex', 'exec', prompt]
        : resume !== undefined && resume !== ''
          ? ['codex', 'resume', resume]
          : prompt === ''
            ? ['codex']
            : ['codex', prompt],
  },
  opencode: {
    // Interactive launches seed the prompt with `--prompt` but keep the TUI open; a headless run uses
    // the one-shot `run` subcommand. Resume reopens a prior session by id
    // (`opencode --session <id>`).
    buildArgv: ({ prompt, headless, resume }) =>
      headless
        ? ['opencode', 'run', prompt]
        : resume !== undefined && resume !== ''
          ? ['opencode', '--session', resume]
          : prompt === ''
            ? ['opencode']
            : ['opencode', '--prompt', prompt],
  },
  gemini: {
    // Gemini's `-p/--prompt` runs headless (one-shot, exits); the interactive
    // TUI is seeded with `--prompt-interactive`. Resume reopens a
    // session id (`gemini --resume <id>`).
    buildArgv: ({ prompt, headless, resume }) =>
      headless
        ? ['gemini', '-p', prompt]
        : resume !== undefined && resume !== ''
          ? ['gemini', '--resume', resume]
          : prompt === ''
            ? ['gemini']
            : ['gemini', '--prompt-interactive', prompt],
  },
  cursor: {
    // Cursor's binary is `cursor-agent`. Interactive launch takes the prompt as
    // a positional arg; `-p` is the headless print mode. Cursor is not resumed,
    // so a resume id falls through to a fresh interactive launch.
    buildArgv: ({ prompt, headless }) =>
      headless
        ? ['cursor-agent', '-p', prompt]
        : prompt === ''
          ? ['cursor-agent']
          : ['cursor-agent', prompt],
  },
  hermes: {
    // Hermes delivers the prompt through its `chat --query=<prompt>` startup
    // contract and runs the full-screen agent under `--tui` (bare
    // `hermes --tui` for an empty prompt). `--cli` is a best-effort
    // non-TUI/headless form. Hermes is not resumed, so a resume id launches fresh.
    buildArgv: ({ prompt, headless }) =>
      headless
        ? ['hermes', 'chat', `--query=${prompt}`, '--cli']
        : prompt === ''
          ? ['hermes', '--tui']
          : ['hermes', 'chat', `--query=${prompt}`, '--tui'],
  },
}

const FENCE = /```json\s*([\s\S]*?)```/g

function tryParse(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text.trim())
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * Carves the agent's structured result out of its transcript. Prefers the last
 * fenced ```json block; falls back to the last bare {...} object. Returns
 * undefined if nothing parses, so the executor errors the node rather than
 * passing junk downstream.
 */
export function extractJsonResult(transcript: string): Record<string, unknown> | undefined {
  const fenced = [...transcript.matchAll(FENCE)]
  if (fenced.length > 0) {
    return tryParse(fenced[fenced.length - 1]![1] ?? '')
  }

  const lastOpen = transcript.lastIndexOf('{')
  const lastClose = transcript.lastIndexOf('}')
  if (lastOpen !== -1 && lastClose > lastOpen) {
    return tryParse(transcript.slice(lastOpen, lastClose + 1))
  }
  return undefined
}
