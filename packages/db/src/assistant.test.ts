import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type ProjectDatabase } from './index.js'
import { AssistantRepository } from './assistant.js'

let db: ProjectDatabase
let assistant: AssistantRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  assistant = new AssistantRepository(db)
})

describe('AssistantRepository', () => {
  it('creates a conversation for a workflow and reuses it', () => {
    const a = assistant.getOrCreateForWorkflow('wf-1', 'claude')
    expect(a.workflowId).toBe('wf-1')
    expect(a.agent).toBe('claude')
    expect(a.sessionId).toBeNull()
    const b = assistant.getOrCreateForWorkflow('wf-1', 'codex')
    expect(b.id).toBe(a.id)
    expect(b.agent).toBe('claude') // reuse keeps the original agent
  })

  it('persists user and assistant messages in order', () => {
    const conv = assistant.getOrCreateForWorkflow('wf-1', 'claude')
    assistant.addMessage({ conversationId: conv.id, role: 'user', content: 'hi' })
    assistant.addMessage({ conversationId: conv.id, role: 'assistant', content: 'hello' })
    const msgs = assistant.listMessages(conv.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[1]?.content).toBe('hello')
  })

  it('stores and round-trips a proposal on an assistant message', () => {
    const conv = assistant.getOrCreateForWorkflow('wf-1', 'claude')
    const proposal = { name: 'Recon', graph: { nodes: [], edges: [] }, summary: 'Empty graph' }
    const msg = assistant.addMessage({ conversationId: conv.id, role: 'assistant', content: 'done', proposal })
    expect(msg.proposal).toEqual(proposal)
    expect(assistant.listMessages(conv.id)[0]?.proposal).toEqual(proposal)
  })

  it('leaves proposal null when omitted', () => {
    const conv = assistant.getOrCreateForWorkflow('wf-1', 'claude')
    const msg = assistant.addMessage({ conversationId: conv.id, role: 'user', content: 'x' })
    expect(msg.proposal).toBeNull()
  })

  it('sets the session id', () => {
    const conv = assistant.getOrCreateForWorkflow('wf-1', 'claude')
    assistant.setSession(conv.id, 'sess-123')
    expect(assistant.get(conv.id)?.sessionId).toBe('sess-123')
  })

  it('switches the agent', () => {
    const conv = assistant.getOrCreateForWorkflow('wf-1', 'claude')
    assistant.setAgent(conv.id, 'codex')
    expect(assistant.get(conv.id)?.agent).toBe('codex')
  })
})
