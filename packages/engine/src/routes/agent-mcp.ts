import { Hono } from 'hono'
import { z } from 'zod'
import { MCP_INJECTABLE_AGENTS } from '../mcp/agent-mcp-injection.js'
import { normalizeAgentMcpWiring, readAgentMcpWiring, writeAgentMcpWiring } from '../infra/agent-mcp.js'

// Only the shape is checked here; normalising drops entries that are not booleans.
const wiringSchema = z.object({ enabled: z.record(z.string(), z.unknown()).optional() }).passthrough()

/**
 * Project-MCP wiring routes (bearer-guarded under /api). The config is
 * user-level (`~/.executioner/agent-mcp.json`), so the per-agent on/off choices
 * follow you into every engagement.
 *   GET  /agent-mcp/config     → the parsed wiring (defaults enabled:{}, all on).
 *   PUT  /agent-mcp/config     → validate + persist the wiring.
 *   GET  /agent-mcp/injectable → the agents the engine can wire the MCP into.
 */
export function agentMcpRoutes(): Hono {
  const app = new Hono()

  app.get('/agent-mcp/config', (c) => c.json(readAgentMcpWiring()))

  app.put('/agent-mcp/config', async (c) => {
    const parsed = wiringSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid config' }, 400)
    return c.json(writeAgentMcpWiring(normalizeAgentMcpWiring(parsed.data)))
  })

  app.get('/agent-mcp/injectable', (c) => c.json({ agents: [...MCP_INJECTABLE_AGENTS] }))

  return app
}
