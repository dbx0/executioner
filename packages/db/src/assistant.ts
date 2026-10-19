import { asc, eq } from 'drizzle-orm'
import { isoNow, newId } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { assistantConversations, assistantMessages } from './tables.js'

/** The AI workflow assistant offers two agents; a conversation is bound to one. */
export type AssistantAgent = string

export interface AssistantConversation {
  id: string
  /** The workflow this thread edits. Null only for a thread not yet bound to a saved workflow. */
  workflowId: string | null
  agent: AssistantAgent
  /** The agent CLI's own resume/session id, learned after the first turn. */
  sessionId: string | null
  createdAt: string
  updatedAt: string
}

/** A proposal captured from the agent's `propose_workflow` MCP call. */
export interface MessageProposal {
  name?: string
  graph: unknown
  summary: string
}

export interface AssistantMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  /** Present on an assistant message that carried a propose_workflow proposal. */
  proposal: MessageProposal | null
  createdAt: string
}

/**
 * A stored proposal, or null when the column is empty or does not hold one.
 * The graph itself stays `unknown`: the UI validates it before applying.
 */
function decodeProposal(text: string | null): MessageProposal | null {
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    if (typeof p.summary !== 'string' || !('graph' in p)) return null
    return {
      graph: p.graph,
      summary: p.summary,
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
    }
  } catch {
    return null
  }
}

const toMessage = (r: typeof assistantMessages.$inferSelect): AssistantMessage => ({
  ...r,
  role: r.role as 'user' | 'assistant',
  proposal: decodeProposal(r.proposal),
})

/**
 * Persistence for the AI workflow assistant: one conversation per workflow, plus
 * its ordered messages. Each assistant message may carry a captured proposal (a
 * full proposed graph + summary) that the UI applies to the canvas on demand.
 */
export class AssistantRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  /** The workflow's conversation, creating it (bound to `agent`) on first use. */
  getOrCreateForWorkflow(workflowId: string, agent: AssistantAgent): AssistantConversation {
    const existing = this.orm
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.workflowId, workflowId))
      .get()
    if (existing !== undefined) return existing

    const now = isoNow()
    const conv: AssistantConversation = {
      id: newId(),
      workflowId,
      agent,
      sessionId: null,
      createdAt: now,
      updatedAt: now,
    }
    this.orm.insert(assistantConversations).values(conv).run()
    return conv
  }

  get(convId: string): AssistantConversation | undefined {
    return this.orm.select().from(assistantConversations).where(eq(assistantConversations.id, convId)).get()
  }

  listMessages(convId: string): AssistantMessage[] {
    return this.orm
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, convId))
      .orderBy(asc(assistantMessages.createdAt))
      .all()
      .map(toMessage)
  }

  addMessage(input: {
    conversationId: string
    role: 'user' | 'assistant'
    content: string
    proposal?: MessageProposal | null | undefined
  }): AssistantMessage {
    const message: AssistantMessage = {
      id: newId(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      proposal: input.proposal ?? null,
      createdAt: isoNow(),
    }
    this.orm
      .insert(assistantMessages)
      .values({ ...message, proposal: message.proposal === null ? null : JSON.stringify(message.proposal) })
      .run()
    this.touch(input.conversationId)
    return message
  }

  setSession(convId: string, sessionId: string): void {
    this.orm
      .update(assistantConversations)
      .set({ sessionId, updatedAt: isoNow() })
      .where(eq(assistantConversations.id, convId))
      .run()
  }

  setAgent(convId: string, agent: AssistantAgent): void {
    this.orm
      .update(assistantConversations)
      .set({ agent, updatedAt: isoNow() })
      .where(eq(assistantConversations.id, convId))
      .run()
  }

  private touch(convId: string): void {
    this.orm
      .update(assistantConversations)
      .set({ updatedAt: isoNow() })
      .where(eq(assistantConversations.id, convId))
      .run()
  }
}
