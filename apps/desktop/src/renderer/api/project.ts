import type { AxiosInstance } from 'axios'

export interface ProjectMeta {
  root: string
  name: string
  icon: string | null
  /** The engagement's default backend profile id for MCP/scheduled runs, or
   *  null to run those locally. */
  defaultBackendProfileId: string | null
}

export const projectApi = (client: AxiosInstance) => ({
  get: () => client.get<ProjectMeta>('/project').then((r) => r.data),
  /**
   * Update the engagement's name, icon and/or default backend. An empty-string
   * icon clears it; an empty-string defaultBackendProfileId clears it back to local.
   */
  update: (patch: { name?: string; icon?: string; defaultBackendProfileId?: string }) =>
    client.patch<ProjectMeta>('/project', patch).then((r) => r.data),
})
