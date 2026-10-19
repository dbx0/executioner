import { Hono } from 'hono'
import { z } from 'zod'

export interface TerminalRequest {
  /** 'shell' spawns the user's shell; 'agent' (default) spawns an agent CLI. */
  kind?: 'shell' | 'agent'
  agent?: string
  /**
   * Resume the agent's prior conversation by its own session id (interactive
   * agents only). A stale/invalid id falls back to a fresh launch rather than
   * erroring — see createTerminal in server.ts.
   */
  resume?: string
  /**
   * Prime a FRESH interactive agent launch with an initial prompt (the TUI opens
   * already primed with this task). Ignored on a resume. Non-agent kinds ignore it.
   */
  prompt?: string
}

/**
 * A resume id or prompt is handed to an agent CLI as an argument, so one that
 * starts with '-' would be read as a flag rather than as text.
 */
const notAFlag = z.string().refine((v) => !v.startsWith('-'), 'must not start with -')

const terminalSchema = z.object({
  kind: z.enum(['shell', 'agent']).optional(),
  agent: z.string().min(1).optional(),
  resume: notAFlag.optional(),
  prompt: notAFlag.optional(),
})

export type TerminalCreator = (input: TerminalRequest) => Promise<{ id: string }> | { id: string }

/** POST /terminals: create a free-standing PTY session (shell or agent), return its id. */
export function terminalRoutes(createTerminal: TerminalCreator): Hono {
  const app = new Hono()

  app.post('/terminals', async (c) => {
    const raw: unknown = await c.req.json().catch(() => ({}))
    const parsed = terminalSchema.safeParse(raw ?? {})
    if (!parsed.success) return c.json({ error: 'invalid terminal request' }, 400)
    const request: TerminalRequest = {}
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) Object.assign(request, { [key]: value })
    }
    const { id } = await createTerminal(request)
    return c.json({ id })
  })

  return app
}
