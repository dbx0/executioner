import type { AxiosInstance } from 'axios'

export interface ProjectMeta {
  root: string
  name: string
  icon: string | null
}

export const projectApi = (client: AxiosInstance) => ({
  get: () => client.get<ProjectMeta>('/project').then((r) => r.data),
  /** Update the engagement's name and/or icon. An empty-string icon clears it. */
  update: (patch: { name?: string; icon?: string }) =>
    client.patch<ProjectMeta>('/project', patch).then((r) => r.data),
})
