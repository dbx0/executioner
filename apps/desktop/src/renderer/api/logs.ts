import type { AxiosInstance } from 'axios'

/** Where the engine log lines came from (see packages/engine/src/routes/logs.ts). */
export type LogSource = 'file' | 'events' | 'empty'

export interface EngineLogs {
  source: LogSource
  lines: string[]
}

export const logsApi = (client: AxiosInstance) => ({
  /** Recent engine log lines (default ~200), newest last. */
  recent: (limit?: number) =>
    client
      .get<EngineLogs>('/logs', limit === undefined ? undefined : { params: { limit } })
      .then((r) => r.data),
})
