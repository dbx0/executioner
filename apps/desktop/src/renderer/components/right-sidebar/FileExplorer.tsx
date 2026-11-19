import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError } from '../../lib/api-error.js'
import { File, Folder, FolderOpen } from 'lucide-react'
import { useApp } from '../../store.js'
import { filesApi, type FileEntry } from '../../api/files.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { Panel, PanelNote, PanelRefresh, PanelRow, PanelRowsSkeleton } from './panel-parts.js'

const ICON = 'size-3.5 shrink-0'

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
    setError(null)
    setLoading(true)
    const api = filesApi(client)
    // Refresh in place: re-list the root plus every directory that is currently
    // expanded, so open folders and the selection survive the refresh instead
    // of collapsing back to the root. A directory that has gone away since it
    // was expanded simply drops out of the rebuilt cache.
    const paths = ['', ...expanded]
    Promise.all(
      paths.map((path) =>
        api.list(path).then(
          (listing) => ({ path, entries: listing.entries }),
          () => null,
        ),
      ),
    )
      .then((results) => {
        if (!mounted.current) return
        const next: Record<string, FileEntry[]> = {}
        for (const result of results) {
          if (result !== null) next[result.path] = result.entries
        }
        setDirs(next)
      })
      .catch((e: unknown) => {
        if (mounted.current) setError(friendlyError(e, 'Couldn’t load files.'))
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
  }, [client, expanded])

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
      const Icon = !isDir ? File : isExpanded ? FolderOpen : Folder
      return (
        <div key={path}>
          <PanelRow
            depth={depth}
            selected={isSelected}
            chevron={!isDir ? 'none' : isExpanded ? 'open' : 'closed'}
            icon={<Icon className={ICON} strokeWidth={1.75} />}
            label={entry.name}
            className="font-mono text-[11.5px]"
            aria-expanded={isDir ? isExpanded : undefined}
            onClick={() => (isDir ? toggleDir(path) : openFilePreview(path, entry.name))}
            onDoubleClick={() => (isDir ? undefined : openFilePermanent(path, entry.name))}
          />
          {isDir && isExpanded ? renderEntries(path, depth + 1) : null}
        </div>
      )
    })
  }

  if (client === null) {
    return (
      <Panel title="Explorer">
        <PanelNote fill>Open an engagement</PanelNote>
      </Panel>
    )
  }

  const rootEntries = dirs['']

  return (
    <Panel title="Explorer" actions={<PanelRefresh label="Refresh explorer" loading={loading} onClick={reload} />}>
      <ScrollArea className="min-h-0 flex-1 px-1.5 pb-2">
        {error !== null && <PanelNote tone="error">{error}</PanelNote>}
        {loading && rootEntries === undefined && <PanelRowsSkeleton label="Loading files" />}
        {rootEntries !== undefined && rootEntries.length === 0 && <PanelNote>Empty directory</PanelNote>}
        {renderEntries('', 0)}
      </ScrollArea>
    </Panel>
  )
}
