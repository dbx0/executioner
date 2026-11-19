import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../../lib/api-error.js'
import { GitBranch } from 'lucide-react'
import { useApp } from '../../store.js'
import { gitApi, type GitStatus, type GitLog, type GitFile } from '../../api/git.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { LoadingState } from '../ui/spinner.js'
import { Panel, PanelNote, PanelRefresh, PanelRow, PanelRowsSkeleton, PanelSection } from './panel-parts.js'

/** Prefer the worktree status char, fall back to the index char; blank = unmodified. */
function statusChar(file: GitFile): string {
  const y = file.y.trim()
  const x = file.x.trim()
  const c = y !== '' ? y : x
  return c === '?' ? 'U' : c === '' ? 'M' : c
}

function statusColor(c: string): string {
  if (c === 'A' || c === 'U') return 'text-status-success'
  if (c === 'D') return 'text-status-error'
  return 'text-muted-foreground'
}

function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf('/')
  if (idx === -1) return { dir: '', base: path }
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) }
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function DiffPreview({ diff }: { diff: string }): JSX.Element {
  const lines = diff.split('\n')
  return (
    <ScrollArea className="h-full min-h-0 flex-1 px-3 py-1.5">
      <pre className="font-mono text-[11px] leading-[1.5]">
        {lines.map((line, i) => {
          let cls = ''
          if (line.startsWith('@@')) cls = 'text-muted-foreground'
          else if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-status-success'
          else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-status-error'
          return (
            <div key={i} className={cn('whitespace-pre-wrap break-all', cls)}>
              {line === '' ? ' ' : line}
            </div>
          )
        })}
      </pre>
    </ScrollArea>
  )
}

export function SourceControl(): JSX.Element {
  const client = useApp((s) => s.client)
  const activeRoot = useApp((s) => s.activeRoot)
  const api = useMemo(() => (client === null ? null : gitApi(client)), [client])

  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitLog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    if (api === null) {
      setStatus(null)
      setLog(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [s, l] = await Promise.all([api.status(), api.log(30)])
        if (cancelled) return
        setStatus(s)
        setLog(l)
      } catch (e) {
        if (cancelled) return
        setError(friendlyError(e, 'Couldn’t load source control.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Refetch on client / root change and on manual refresh.

  }, [api, activeRoot, nonce])

  // Reset the selected diff whenever the engagement changes.
  useEffect(() => {
    setSelectedPath(null)
    setDiff('')
  }, [activeRoot])

  useEffect(() => {
    if (api === null || selectedPath === null) return
    let cancelled = false
    setDiffLoading(true)
    void (async () => {
      try {
        const d = await api.diff(selectedPath)
        if (!cancelled) setDiff(d.diff)
      } catch {
        if (!cancelled) setDiff('')
      } finally {
        if (!cancelled) setDiffLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, selectedPath])

  const refresh = (
    <PanelRefresh label="Refresh" loading={loading} disabled={api === null} onClick={() => setNonce((n) => n + 1)} />
  )

  if (client === null) {
    return (
      <Panel title="Source Control" actions={refresh}>
        <PanelNote fill>Open an engagement</PanelNote>
      </Panel>
    )
  }

  if (status !== null && status.isRepo === false) {
    return (
      <Panel title="Source Control" actions={refresh}>
        <PanelNote fill>Not a git repository</PanelNote>
      </Panel>
    )
  }

  const files = status?.files ?? []
  const commits = log?.commits ?? []

  return (
    <Panel title="Source Control" actions={refresh}>
      {status !== null && (
        <div className="flex items-center gap-1.5 px-3.5 pb-1 text-[12px] text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{status.branch ?? 'detached'}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1 px-1.5 pb-2">
          {error !== null && <PanelNote tone="error">{error}</PanelNote>}
          {loading && status === null ? (
            <PanelRowsSkeleton label="Loading source control" />
          ) : (
            <>
              <PanelSection count={files.length}>Changes</PanelSection>
              {files.length === 0 ? (
                <PanelNote>No changes</PanelNote>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {files.map((f) => {
                    const c = statusChar(f)
                    const { dir, base } = splitPath(f.path)
                    return (
                      <PanelRow
                        key={f.path}
                        selected={selectedPath === f.path}
                        onClick={() => setSelectedPath(f.path)}
                        title={f.path}
                        icon={<span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', statusColor(c))}>{c}</span>}
                        label={
                          <>
                            {dir !== '' && <span className="text-tertiary-foreground">{dir}</span>}
                            <span className="font-medium">{base}</span>
                          </>
                        }
                      />
                    )
                  })}
                </div>
              )}

              <PanelSection>History</PanelSection>
              {commits.length === 0 ? (
                <PanelNote>No history</PanelNote>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {commits.map((c) => (
                    <PanelRow
                      key={c.hash}
                      title={`${c.subject} (${c.author})`}
                      icon={<span className="shrink-0 font-mono text-[11px] text-tertiary-foreground">{c.shortHash}</span>}
                      label={c.subject}
                      trailing={<span className="shrink-0 text-[11px] text-tertiary-foreground">{shortDate(c.date)}</span>}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </ScrollArea>

        {selectedPath !== null && (
          <div className="flex h-[40%] min-h-0 shrink-0 flex-col border-t border-glass-border">
            <div className="flex h-8 shrink-0 items-center gap-2 pl-3.5 pr-1.5 text-[11px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate font-mono">{selectedPath}</span>
              <Button variant="ghost" size="xs" onClick={() => setSelectedPath(null)} aria-label="Close diff">
                Close
              </Button>
            </div>
            {diffLoading ? (
              <LoadingState label="Loading diff" />
            ) : diff === '' ? (
              <PanelNote fill>No diff</PanelNote>
            ) : (
              <DiffPreview diff={diff} />
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
