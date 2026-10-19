import type { AxiosInstance } from 'axios'

export interface GitFile {
  path: string
  x: string
  y: string
}
export interface GitStatus {
  isRepo: boolean
  branch: string | null
  files: GitFile[]
}
export interface GitCommit {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
}
export interface GitLog {
  isRepo: boolean
  commits: GitCommit[]
}
export interface GitDiff {
  isRepo: boolean
  path: string
  diff: string
}

export const gitApi = (client: AxiosInstance) => ({
  status: () => client.get<GitStatus>('/git/status').then((r) => r.data),
  log: (limit?: number) =>
    client.get<GitLog>('/git/log', { params: limit ? { limit } : {} }).then((r) => r.data),
  diff: (path?: string) =>
    client.get<GitDiff>('/git/diff', { params: path ? { path } : {} }).then((r) => r.data),
})
