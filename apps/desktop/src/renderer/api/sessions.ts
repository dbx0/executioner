import type { AxiosInstance } from 'axios'

export interface SessionSummary {
  id: string
  title: string
  firstPrompt: string | null
  messageCount: number
  modifiedAt: number
  sizeBytes: number
}

export const sessionsApi = (client: AxiosInstance) => ({
  list: () => client.get<{ sessions: SessionSummary[] }>('/sessions').then((r) => r.data.sessions),
})
