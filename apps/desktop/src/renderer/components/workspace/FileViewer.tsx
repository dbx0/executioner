import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import type { AxiosInstance } from 'axios'
import { filesApi, type FileContent } from '../../api/files.js'
import { friendlyError } from '../../lib/api-error.js'
import type { FileTab } from '../../store.js'
import { FileEditor } from './editor/FileEditor.js'
import { isMarkdownPath, looksBinary } from './file-kind.js'

export { isMarkdownPath, looksBinary }

function Placeholder({ icon, title, detail }: { icon: JSX.Element; title: string; detail?: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{title}</p>
      {detail !== undefined && <p className="max-w-md break-all text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}

/**
 * Renders one opened file: loading, error, binary, or the editor. Content is
 * fetched once per path; the component stays mounted (hidden) across tab
 * switches, and unsaved edits live in the store, so they survive either way.
 */
export function FileViewer({ client, file }: { client: AxiosInstance; file: FileTab }): JSX.Element {
  const [content, setContent] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent(null)
    filesApi(client)
      .read(file.path)
      .then((c) => {
        if (!cancelled) setContent(c)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(friendlyError(e, 'Couldn\u2019t open this file.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, file.path])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>
  }
  if (error !== null || content === null) {
    return (
      <Placeholder
        icon={<FileWarning className="size-8 text-muted-foreground" strokeWidth={1.5} />}
        title="Couldn’t open this file"
        detail={error ?? 'This file could not be read.'}
      />
    )
  }
  if (looksBinary(content.content)) {
    return (
      <Placeholder
        icon={<FileWarning className="size-8 text-muted-foreground" strokeWidth={1.5} />}
        title="Binary file not shown"
        detail={file.path}
      />
    )
  }

  // Key by path so switching the preview slot to a new file resets editor state.
  return <FileEditor key={file.path} client={client} file={file} initial={content} />
}
