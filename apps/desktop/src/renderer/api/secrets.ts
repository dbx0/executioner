import type { AxiosInstance } from 'axios'

export interface Secret {
  key: string
  value: string
  updatedAt: string
}

export const secretsApi = (client: AxiosInstance) => ({
  list: () => client.get<Secret[]>('/secrets').then((r) => r.data),
  set: (key: string, value: string) => client.put<Secret>(`/secrets/${encodeURIComponent(key)}`, { value }).then((r) => r.data),
  remove: (key: string) => client.delete(`/secrets/${encodeURIComponent(key)}`).then((r) => r.data),
})
