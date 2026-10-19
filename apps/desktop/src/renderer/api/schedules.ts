import type { AxiosInstance } from 'axios'

export type ScheduleKind = 'interval' | 'on_create'

export interface Schedule {
  id: string
  workflowId: string
  targetId: string | null
  kind: ScheduleKind
  intervalSeconds: number | null
  targetKind: string | null
  enabled: boolean
  createdAt: string
}

export interface ScheduleInput {
  workflowId: string
  kind: ScheduleKind
  targetId?: string | null
  intervalSeconds?: number
  targetKind?: string
  enabled?: boolean
}

export const schedulesApi = (client: AxiosInstance) => ({
  list: () => client.get<Schedule[]>('/schedules').then((r) => r.data),
  create: (body: ScheduleInput) => client.post<Schedule>('/schedules', body).then((r) => r.data),
  setEnabled: (id: string, enabled: boolean) =>
    client.patch<Schedule>(`/schedules/${id}`, { enabled }).then((r) => r.data),
  remove: (id: string) => client.delete(`/schedules/${id}`).then((r) => r.data),
})
