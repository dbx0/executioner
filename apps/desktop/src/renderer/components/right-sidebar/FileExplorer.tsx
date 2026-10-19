import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError } from '../../lib/api-error.js'
import { ChevronRight, File, Folder, FolderOpen, RotateCw } from 'lucide-react'
import { useApp } from '../../store.js'
import { filesApi, type FileEntry } from '../../api/files.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { ScrollArea } from '../ui/scroll-area.js'

/** Join a child name onto its parent directory path (root parent is ''). */
function joinPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

/**
 * A collapsible-directory tree of the engagement root, backed by the engine's
 * /files endpoints. Self-contained: it caches loaded directories and the set of
 * expanded paths in local state. Selecting a file opens it as a tab in the main
 * workspace (via the store) instead of a local preview pane.
 */
export function FileExplorer(): JSX.Element {
  const client = useApp((s) => s.client)
  const root = useApp((s) => s.activeRoot)
  const openFileTab = useApp((s) => s.openFile)

  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Load the root directory on mount and whenever the connection or engagement
  // root changes. A cancelled flag guards against a stale response landing after
  // the client/root has already moved on.
  useEffect(() => {
    if (client === null) return
    let cancelled = false
    setDirs({})
    setExpanded(new Set())
    setSelected(null)
    setError(null)
    setLoading(true)
    filesApi(client)
      .list('')
      .then((listing) => {
        if (!cancelled) setDirs({ '': listing.entries })
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(friendlyError(e, 'Couldn’t load files.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, root])

  const reload = useCallback(() => {
    if (client === null) return
    setDirs({})
    setExpanded(new Set())
    setSelected(null)
    setError(null)
    setLoading(true)
    filesApi(client)
      .list('')
      .then((listing) => {
        if (mounted.current) setDirs({ '': listing.entries })
      })
      .catch((e: unknown) => {
        if (mounted.current) setError(friendlyError(e, 'Couldn’t load files.'))
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
  }, [client])

  const toggleDir = useCallback(
    (path: string) => {
      const willExpand = !expanded.has(path)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
      // Lazy-load children the first time this dir is expanded.
      if (willExpand && client !== null && dirs[path] === undefined) {
        filesApi(client)
          .list(path)
          .then((listing) => {
            if (mounted.current) setDirs((d) => ({ ...d, [path]: listing.entries }))
          })
          .catch((e: unknown) => {
            if (mounted.current) setError(friendlyError(e, 'Couldn’t load files.'))
          })
      }
    },
    [client, dirs, expanded],
  )

  // Single-click opens (or reuses) the ephemeral preview tab; double-click opens
  // it permanently.
  const openFilePreview = useCallback(
    (path: string, name: string) => {
      if (client === null) return
      setSelected(path)
      openFileTab(path, name, { preview: true })
    },
    [client, openFileTab],
  )
  const openFilePermanent = useCallback(
    (path: string, name: string) => {
      if (client === null) return
      setSelected(path)
      openFileTab(path, name, { preview: false })
    },
    [client, openFileTab],
  )

  const renderEntries = (parentPath: string, depth: number): JSX.Element[] => {
    const entries = dirs[parentPath]
    if (entries === undefined) return []
    return entries.map((entry) => {
      const path = joinPath(parentPath, entry.name)
      const isDir = entry.type === 'dir'
      const isExpanded = expanded.has(path)
      const isSelected = selected === path && !isDir
      return (
        <div key={path}>
          <button
            type="button"
            onClick={() => (isDir ? toggleDir(path) : openFilePreview(path, entry.name))}
            onDoubleClick={() => (isDir ? undefined : openFilePermanent(path, entry.name))}
            style={{ paddingLeft: 6 + depth * 12 }}
            className={cn(
              'flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-[12.5px] transition-colors',
              isSelected
                ? 'selected-surface text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-surface-2',
            )}
          >
            {isDir ? (
              <ChevronRight
                className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
                strokeWidth={2}
              />
            ) : (
              <span className="size-3 shrink-0" />
            )}
            {isDir ? (
              isExpanded ? (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              ) : (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              )
            ) : (
              <File className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {isDir && isExpanded ? renderEntries(path, depth + 1) : null}
        </div>
      )
    })
  }

  if (client === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
        Open an engagement
      </div>
    )
  }

  const rootEntries = dirs['']

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Explorer</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={reload}
          aria-label="Refresh explorer"
        >
          <RotateCw className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-1 pb-2">
        {error !== null && <p className="px-2 py-1 text-[12px] text-muted-foreground">{error}</p>}
        {loading && rootEntries === undefined && (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">Loading files…</p>
        )}
        {rootEntries !== undefined && rootEntries.length === 0 && (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">Empty directory</p>
        )}
        {renderEntries('', 0)}
      </ScrollArea>
    </div>
  )
}
