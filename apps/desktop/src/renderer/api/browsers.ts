import type { AxiosInstance } from 'axios'

/** One browser as the engine reports it. */
export interface BrowserItem {
  id: string
  owner: string | null
  url: string
  title: string
}

export const browsersApi = (client: AxiosInstance) => ({
  list: () => client.get<BrowserItem[]>('/browsers').then((r) => r.data),
  create: (body: { id?: string; url?: string; title?: string }) =>
    client.post<BrowserItem>('/browsers', body).then((r) => r.data),
  update: (id: string, patch: { owner?: string | null; url?: string; title?: string }) =>
    client.patch<BrowserItem>(`/browsers/${encodeURIComponent(id)}`, patch).then((r) => r.data),
  remove: (id: string) => client.delete(`/browsers/${encodeURIComponent(id)}`).then(() => undefined),
})
