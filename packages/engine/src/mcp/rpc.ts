import type { ProjectToolset, ToolCaller } from './toolset.js'
import { TOOL_SCHEMAS } from './schema.js'

export interface RpcRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

export interface RpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

const PROTOCOL_VERSION = '2024-11-05'

/**
 * Answer one JSON-RPC request. `allowed`, when given, is the caller's tool
 * allow-list: other tools are left out of tools/list and refused by tools/call
 * before they run, so an agent CLI that ignores its own allow-list is still held
 * to it here. `caller` is who the scoped token says is calling, which decides
 * whose node output or proposal a call may reach.
 */
export async function dispatchRpc(
  toolset: ProjectToolset,
  req: RpcRequest,
  allowed?: ReadonlySet<string>,
  caller: ToolCaller = {},
): Promise<RpcResponse> {
  const base = { jsonrpc: '2.0' as const, id: req.id ?? null }

  if (req.method === 'initialize') {
    return {
      ...base,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'executioner-project', version: '0.0.1' },
      },
    }
  }

  if (req.method === 'tools/list') {
    const tools = allowed === undefined ? TOOL_SCHEMAS : TOOL_SCHEMAS.filter((t) => allowed.has(t.name))
    return { ...base, result: { tools } }
  }

  if (req.method === 'tools/call') {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
    const name = params.name ?? ''
    if (allowed !== undefined && !allowed.has(name)) {
      return { ...base, result: { isError: true, content: [{ type: 'text', text: `${name} is not available to this agent session` }] } }
    }
    try {
      const result = await toolset.call(name, params.arguments ?? {}, caller)
      return { ...base, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }
    } catch (error) {
      // MCP convention: a tool that fails returns isError content, not a protocol error.
      return { ...base, result: { isError: true, content: [{ type: 'text', text: (error as Error).message }] } }
    }
  }

  return { ...base, error: { code: -32601, message: `method not found: ${req.method}` } }
}
