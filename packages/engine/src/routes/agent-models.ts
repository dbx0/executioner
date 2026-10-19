import { execFile } from 'node:child_process'
import { Hono } from 'hono'

/**
 * The models an agent can be pinned to, resolved from the agent itself where its
 * CLI can report them. Only some CLIs expose a machine-readable list:
 *   - opencode → `opencode models` prints one model id per line.
 *   - claude   → no list command; its model selection is the sonnet/opus/haiku
 *                aliases, so those are returned as the known set.
 * For the rest we can't enumerate reliably, so `models` is empty and the client
 * falls back to a free-text field. `source` says where the list came from.
 */

export interface AgentModelsResult {
  agent: string
  models: string[]
  source: 'cli' | 'known' | 'none'
}

/** Claude Code has no "list models" command; these are its selectable aliases. */
const CLAUDE_ALIASES = ['sonnet', 'opus', 'haiku']

/** Runs a CLI and resolves its stdout, or null on any failure/timeout. */
export type ModelProbe = (program: string, args: string[]) => Promise<string | null>

const defaultProbe: ModelProbe = (program, args) =>
  new Promise((resolve) => {
    try {
      execFile(program, args, { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        resolve(err ? null : stdout)
      })
    } catch {
      resolve(null)
    }
  })

/** Parse `opencode models` output into model ids (one per line, e.g. provider/model). */
export function parseModelLines(stdout: string): string[] {
  return [
    ...new Set(
      stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#') && /^[\w./:-]+$/.test(l)),
    ),
  ]
}

export async function listAgentModels(agent: string, probe: ModelProbe = defaultProbe): Promise<AgentModelsResult> {
  if (agent === 'claude') return { agent, models: CLAUDE_ALIASES, source: 'known' }
  if (agent === 'opencode') {
    const out = await probe('opencode', ['models'])
    if (out !== null) {
      const models = parseModelLines(out)
      if (models.length > 0) return { agent, models, source: 'cli' }
    }
  }
  // gemini / codex / cursor / hermes don't expose a parseable model list.
  return { agent, models: [], source: 'none' }
}

export interface AgentModelsDeps {
  probe?: ModelProbe
}

export function agentModelsRoutes(deps: AgentModelsDeps = {}): Hono {
  const app = new Hono()
  const probe = deps.probe ?? defaultProbe
  app.get('/agent-models', async (c) => {
    const agent = c.req.query('agent') ?? ''
    if (agent === '') return c.json({ error: 'agent required' }, 400)
    return c.json(await listAgentModels(agent, probe))
  })
  return app
}
