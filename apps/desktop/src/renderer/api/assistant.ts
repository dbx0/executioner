import type { AxiosInstance } from 'axios'
import type { Graph } from '../lib/graph-types.js'

/** A proposal captured from the agent, applied to the canvas on demand. */
export interface AssistantProposal {
  name?: string
  graph: Graph
  summary: string
}

export interface AssistantConversation {
  id: string
  workflowId: string | null
  agent: string
  sessionId: string | null
  createdAt: string
  updatedAt: string
}

export interface AssistantMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  proposal: AssistantProposal | null
  createdAt: string
}

export const assistantApi = (client: AxiosInstance) => ({
  conversation: (workflowId: string, agent: string) =>
    client
      .get<{ conversation: AssistantConversation; messages: AssistantMessage[] }>('/assistant/conversation', {
        params: { workflowId, agent },
      })
      .then((r) => r.data),
  send: (conversationId: string, body: { text: string; graph: Graph; agent: string }) =>
    client
      .post<{ message: AssistantMessage }>(`/assistant/conversation/${conversationId}/message`, body)
      .then((r) => r.data.message),
  setAgent: (conversationId: string, agent: string) =>
    client
      .patch<{ conversation: AssistantConversation }>(`/assistant/conversation/${conversationId}`, { agent })
      .then((r) => r.data.conversation),
})
