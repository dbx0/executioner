import { Hono } from 'hono'
import { agentGrantOf, bearerAuth } from '../transport/auth.js'
import type { AgentTokenRegistry } from '../transport/agent-tokens.js'
import { dispatchRpc, type RpcRequest } from './rpc.js'
import type { ProjectToolset } from './toolset.js'

const MCP_ROUTES: ReadonlySet<string> = new Set(['POST /mcp'])

/**
 * Mounts the MCP JSON-RPC endpoint. The master token gets every tool; a scoped
 * agent token gets only the tools its grant names.
 */
export function mcpRoute(toolset: ProjectToolset, token: string, agentTokens?: AgentTokenRegistry): Hono {
  const app = new Hono()
  app.use('/mcp', bearerAuth(token, agentTokens === undefined ? undefined : { registry: agentTokens, routes: MCP_ROUTES }))
  app.post('/mcp', async (c) => {
    const body = (await c.req.json().catch(() => null)) as RpcRequest | null
    if (body === null || body.jsonrpc !== '2.0') {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } }, 400)
    }
    const grant = agentGrantOf(c)
    const caller =
      grant === undefined
        ? {}
        : { profile: grant.profile, ...(grant.sessionId === undefined ? {} : { sessionId: grant.sessionId }) }
    return c.json(await dispatchRpc(toolset, body, grant?.tools, caller))
  })
  return app
}
