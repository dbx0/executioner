import type { AxiosInstance } from 'axios'

export type BackendKind = 'local' | 'ssh' | 'docker'

export interface BackendProfile {
  id: string
  name: string
  kind: BackendKind
  host?: string
  port?: number
  user?: string
  identityFile?: string
  image?: string
  workdir?: string
  env?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface BackendProfileInput {
  name: string
  kind: BackendKind
  host?: string
  port?: number
  user?: string
  identityFile?: string
  image?: string
  workdir?: string
  env?: Record<string, string>
}

/** One step of a liveness test (spinner → check/✗ per step in the UI). */
export interface BackendTestStep {
  name: string
  ok: boolean
  detail?: string
}

/** The engine's response to POST /backends/test (mirrors the engine shape). */
export interface BackendTestResult {
  ok: boolean
  steps: BackendTestStep[]
  error?: string
  /** Set when the SSH host is reachable but the configured workdir is absent. */
  missingWorkdir?: string
}

/** Input for POST /backends/ssh-enroll (password is transient, never persisted). */
export interface SshEnrollInput {
  host: string
  user: string
  password: string
  port?: number
}

/** The engine's response to POST /backends/ssh-enroll (mirrors the engine shape). */
export interface SshEnrollResult {
  ok: boolean
  /** Path of the generated private key to save as the profile's identityFile. */
  identityFile: string | null
  steps: BackendTestStep[]
  error?: string
}

export const backendsApi = (client: AxiosInstance) => ({
  list: () => client.get<BackendProfile[]>('/backends').then((r) => r.data),
  create: (body: BackendProfileInput) => client.post<BackendProfile>('/backends', body).then((r) => r.data),
  update: (id: string, body: BackendProfileInput) =>
    client.put<BackendProfile>(`/backends/${id}`, body).then((r) => r.data),
  remove: (id: string) => client.delete(`/backends/${id}`).then((r) => r.data),
  test: (body: BackendProfileInput, opts?: { createWorkdir?: boolean }) =>
    client
      .post<BackendTestResult>(`/backends/test${opts?.createWorkdir === true ? '?createWorkdir=1' : ''}`, body)
      .then((r) => r.data),
  sshEnroll: (body: SshEnrollInput) =>
    client.post<SshEnrollResult>('/backends/ssh-enroll', body).then((r) => r.data),
})
