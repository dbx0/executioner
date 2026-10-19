import type { AxiosInstance } from 'axios'

export interface CreatedTerminal {
  id: string
}

export type TerminalSpec = { kind: 'shell' } | { agent: string; resume?: string; prompt?: string }

export const terminalsApi = (client: AxiosInstance) => ({
  create: (spec: TerminalSpec) =>
    client.post<CreatedTerminal>('/terminals', spec).then((r) => r.data),
})
