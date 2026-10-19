import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createProject, type Project } from '@exe/project'
import { assistantRoutes, type AssistantRunnerLike } from './assistant.js'
import type { AssistantRunInput, AssistantRunResult } from '../agents/assistant-runner.js'
import { PROFILE_TOOLS, TOOL_ACCESS, type ToolName } from '../mcp/toolset.js'

let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-assistant-route-'))
  project = createProject(dir, { name: 'test' })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

function buildApp(runner: AssistantRunnerLike): Hono {
  const app = new Hono()
  app.route('/', assistantRoutes({ project, runner }))
  return app
}

const graph = { nodes: [{ id: 'm', type: 'manual', data: {} }], edges: [] }

describe('assistant routes', () => {
  it('creates a conversation and returns its (empty) messages', async () => {
    const runner = { run: vi.fn() }
    const app = buildApp(runner)
    const res = await app.request('/assistant/conversation?workflowId=wf-1&agent=claude')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { conversation: { workflowId: string }; messages: unknown[] }
    expect(body.conversation.workflowId).toBe('wf-1')
    expect(body.messages).toEqual([])
  })

  it('persists user + assistant messages, captures the proposal, and sets the session', async () => {
    const proposal = { name: 'WF', graph, summary: 'one node' }
    const runner: AssistantRunnerLike = {
      run: vi.fn(async (): Promise<AssistantRunResult> => ({ reply: 'done', sessionId: 'sess-1', proposal })),
    }
    const app = buildApp(runner)

    const conv = project.assistant.getOrCreateForWorkflow('wf-1', 'claude')
    const res = await app.request(`/assistant/conversation/${conv.id}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'make a recon flow', graph, agent: 'claude' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message: { role: string; content: string; proposal: unknown } }
    expect(body.message.role).toBe('assistant')
    expect(body.message.content).toBe('done')
    expect(body.message.proposal).toEqual(proposal)

    const msgs = project.assistant.listMessages(conv.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(project.assistant.get(conv.id)?.sessionId).toBe('sess-1')
    // The live graph goes to this turn's run, to bind to its own session.
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ graph }))
  })

  it('uses the full context prompt on the first turn and resume on the second', async () => {
    const run = vi.fn(async (_input: AssistantRunInput): Promise<AssistantRunResult> => ({
      reply: 'ok',
      sessionId: 'sess-2',
    }))
    const app = buildApp({ run })
    const conv = project.assistant.getOrCreateForWorkflow('wf-1', 'claude')

    await app.request(`/assistant/conversation/${conv.id}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'first', graph }),
    })
    const firstArg = run.mock.calls[0]![0]
    expect(firstArg.sessionId).toBeUndefined()
    expect(firstArg.prompt).toMatch(/list_node_types/)

    await app.request(`/assistant/conversation/${conv.id}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'second', graph }),
    })
    const secondArg = run.mock.calls[1]![0]
    expect(secondArg.sessionId).toBe('sess-2')
    expect(secondArg.prompt).not.toMatch(/list_node_types/)
  })

  it('only tells the assistant about tools of its own profile', async () => {
    const run = vi.fn(async (_input: AssistantRunInput): Promise<AssistantRunResult> => ({ reply: 'ok', sessionId: 's' }))
    const app = buildApp({ run })
    const conv = project.assistant.getOrCreateForWorkflow('wf-1', 'claude')
    for (const text of ['first', 'second']) {
      await app.request(`/assistant/conversation/${conv.id}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, graph }),
      })
    }
    for (const [input] of run.mock.calls) {
      const named = (Object.keys(TOOL_ACCESS) as ToolName[]).filter((t) => new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9_])`).test(input.prompt))
      expect(named.length).toBeGreaterThan(0)
      for (const tool of named) expect(PROFILE_TOOLS.assistant).toContain(tool)
    }
  })

  it('switches the agent via PATCH', async () => {
    const app = buildApp({ run: vi.fn() })
    const conv = project.assistant.getOrCreateForWorkflow('wf-1', 'claude')
    const res = await app.request(`/assistant/conversation/${conv.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'codex' }),
    })
    expect(res.status).toBe(200)
    expect(project.assistant.get(conv.id)?.agent).toBe('codex')
  })

  it('404s posting to an unknown conversation', async () => {
    const app = buildApp({ run: vi.fn() })
    const res = await app.request('/assistant/conversation/nope/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x', graph }),
    })
    expect(res.status).toBe(404)
  })
})
