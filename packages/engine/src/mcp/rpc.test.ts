import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { ProjectToolset } from './toolset.js'
import { dispatchRpc } from './rpc.js'

let dir: string
let project: Project
let toolset: ProjectToolset

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-rpc-'))
  project = createProject(dir, { name: 'test' })
  toolset = new ProjectToolset({ project, runWorkflow: vi.fn() })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('dispatchRpc', () => {
  it('answers initialize with protocol and capabilities', async () => {
    const res = await dispatchRpc(toolset, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(res.result).toMatchObject({ capabilities: { tools: {} } })
    expect(res.id).toBe(1)
  })

  it('lists tools with schemas', async () => {
    const res = await dispatchRpc(toolset, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const tools = (res.result as { tools: Array<{ name: string }> }).tools
    expect(tools.map((t) => t.name)).toContain('list_targets')
    expect(tools.map((t) => t.name)).toContain('add_finding')
  })

  it('calls a tool and wraps the result as mcp content', async () => {
    project.targets.upsert({ kind: 'domain', value: 'a.com', source: 'manual' })
    const res = await dispatchRpc(toolset, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_targets', arguments: {} },
    })
    const content = (res.result as { content: Array<{ type: string; text: string }> }).content
    expect(content[0]!.type).toBe('text')
    expect(JSON.parse(content[0]!.text)).toHaveLength(1)
  })

  it('returns an error result (not a throw) when a tool fails', async () => {
    const res = await dispatchRpc(toolset, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'add_finding', arguments: { target: 'ghost', severity: 'low', title: 'x' } },
    })
    expect((res.result as { isError?: boolean }).isError).toBe(true)
  })

  it('returns a JSON-RPC error for an unknown method', async () => {
    const res = await dispatchRpc(toolset, { jsonrpc: '2.0', id: 5, method: 'nonsense', params: {} })
    expect(res.error?.code).toBe(-32601)
  })

  describe('with an allow-list', () => {
    const allowed = new Set(['list_targets'])

    it('lists only the allowed tools', async () => {
      const res = await dispatchRpc(toolset, { jsonrpc: '2.0', id: 6, method: 'tools/list' }, allowed)
      const tools = (res.result as { tools: Array<{ name: string }> }).tools
      expect(tools.map((t) => t.name)).toEqual(['list_targets'])
    })

    it('refuses a tool outside the list without running it', async () => {
      const call = vi.spyOn(toolset, 'call')
      const res = await dispatchRpc(
        toolset,
        { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'run_command', arguments: { command: 'id' } } },
        allowed,
      )
      expect(res.result).toMatchObject({ isError: true })
      expect(call).not.toHaveBeenCalled()
    })

    it('runs an allowed tool', async () => {
      const res = await dispatchRpc(
        toolset,
        { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'list_targets', arguments: {} } },
        allowed,
      )
      expect((res.result as { isError?: boolean }).isError).toBeUndefined()
    })
  })
})
