import type { AxiosInstance } from 'axios'

export interface FileEntry {
  name: string
  type: 'file' | 'dir'
}
export interface DirListing {
  path: string
  entries: FileEntry[]
}
/** mtime + size: the cheap change hint an open tab polls for. */
export interface FileStat {
  path: string
  mtimeMs: number
  size: number
}
export interface FileContent {
  path: string
  content: string
  truncated: boolean
  mtimeMs: number
  size: number
}

export interface FileWriteResult {
  path: string
  ok: boolean
  mtimeMs: number
  size: number
}

export const filesApi = (client: AxiosInstance) => ({
  list: (path?: string) =>
    client.get<DirListing>('/files', { params: path ? { path } : {} }).then((r) => r.data),
  read: (path: string) => client.get<FileContent>('/files/read', { params: { path } }).then((r) => r.data),
  stat: (path: string) => client.get<FileStat>('/files/stat', { params: { path } }).then((r) => r.data),
  write: (path: string, content: string) =>
    client.put<FileWriteResult>('/files', { path, content }).then((r) => r.data),
})
