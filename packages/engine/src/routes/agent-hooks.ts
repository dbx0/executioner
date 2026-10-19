import { homedir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { confineAbsolute } from '../infra/confine.js'
import { agentGrantOf } from '../transport/auth.js'
import type { EventBus } from '../transport/events.js'
import type { TranscriptWatchers } from '../infra/transcript-watch.js'

const agentEventSchema = z.object({
  sessionId: z.string().min(1),
  event: z.string().min(1),
  payload: z.unknown().optional(),
})

/** Where Claude Code keeps its session transcripts; the only place one is tailed from. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLAUDE_CONFIG_DIR
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.claude')
}

/**
 * The transcript a hook payload names, if it is one the engine may tail: a
 * `.jsonl` file inside Claude's own config directory. The path arrives in a
 * request body, so without this any file the engine can read could be tailed
 * and republished on the event bus.
 */
export function transcriptPathFrom(payload: unknown, configDir: string = claudeConfigDir()): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const candidate = (payload as { transcript_path?: unknown }).transcript_path
  if (typeof candidate !== 'string' || !candidate.endsWith('.jsonl')) return undefined
  return confineAbsolute(configDir, candidate) ?? undefined
}

/**
 * POST /agent-events: Claude Code hook forwarders post lifecycle payloads here.
 * We rebroadcast them over the event bus (type 'agent', keyed by the terminal
 * session id) for live status, and when a payload carries the session's
 * transcript path we start tailing it for sub-agent activity (which background
 * sub-agents do not report through hooks).
 */
export function agentHookRoutes(bus: EventBus, watchers: TranscriptWatchers): Hono {
  const app = new Hono()

  app.post('/agent-events', async (c) => {
    const parsed = agentEventSchema.safeParse(await c.req.json().catch(() => null))
    // A forwarder never waits on the answer, so a malformed post is dropped quietly.
    if (!parsed.success) return c.json({ ok: true })
    const { sessionId, event, payload } = parsed.data
    // An agent's scoped token speaks for its own session only, so one agent
    // cannot paint another's status or start a transcript tail under its id.
    const grant = agentGrantOf(c)
    if (grant !== undefined && grant.sessionId !== sessionId) return c.json({ error: 'forbidden' }, 403)
    bus.publish({ type: 'agent', executionId: sessionId, nodeId: event, data: JSON.stringify(payload ?? {}) })
    const transcriptPath = transcriptPathFrom(payload)
    if (transcriptPath !== undefined) watchers.observe(sessionId, transcriptPath)
    return c.json({ ok: true })
  })

  return app
}
